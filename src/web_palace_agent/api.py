from __future__ import annotations

import asyncio
import io
import json
import os
import zipfile
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .orchestrator import Orchestrator
from .project_store import ProjectRecord, ProjectStore, SourceRecord
from .providers import AgentProvider, LangChainAgentProvider
from .registry import PalaceRecord, PalaceRegistry
from .schemas import (
    ImageGenerationSettings,
    ProjectConfig,
    SpecialistModels,
    WorkflowState,
    WorkflowStatus,
)

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
TERMINAL_STATUSES = {
    WorkflowStatus.ACCEPTED,
    WorkflowStatus.ACCEPTED_WITH_NOTES,
    WorkflowStatus.NEEDS_HUMAN_INPUT,
    WorkflowStatus.APPROVAL_REQUIRED,
    WorkflowStatus.ITERATION_LIMIT_REACHED,
    WorkflowStatus.MODEL_CALL_LIMIT_REACHED,
    WorkflowStatus.COST_LIMIT_REACHED,
    WorkflowStatus.WORKFLOW_FAILED,
}
PROVIDER_KEYS = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}


class ProjectRequest(BaseModel):
    project_name: str = Field(min_length=2, max_length=100)
    subject: str = Field(min_length=2, max_length=200)
    audience: str = Field(min_length=2, max_length=500)
    objective: str = Field(min_length=2, max_length=1000)
    requirements: str = Field(min_length=10, max_length=20_000)
    models: SpecialistModels
    image_generation: ImageGenerationSettings = Field(default_factory=ImageGenerationSettings)
    maximum_build_iterations: int = Field(default=2, ge=1, le=10)
    maximum_architecture_revisions: int = Field(default=1, ge=0, le=5)
    maximum_model_calls: int = Field(default=8, ge=3, le=100)
    maximum_estimated_cost_usd: float | None = Field(default=None, gt=0)
    require_build_approval: bool = True
    allowed_commands: list[str] = Field(default_factory=list)


class ProjectResponse(BaseModel):
    id: str
    project_name: str
    subject: str
    created_at: str
    sources: list[dict[str, Any]]


class ResumeRequest(BaseModel):
    decision: str
    feedback: str = Field(default="", max_length=4000)


class ProviderStatus(BaseModel):
    id: str
    label: str
    configured: bool
    environment_variable: str


class RunManager:
    def __init__(
        self,
        projects: ProjectStore,
        runs_root: Path,
        registry: PalaceRegistry,
        provider_factory: Callable[[], AgentProvider],
        require_provider_keys: bool = True,
    ) -> None:
        self.projects = projects
        self.runs_root = runs_root.resolve()
        self.runs_root.mkdir(parents=True, exist_ok=True)
        self.registry = registry
        self.provider_factory = provider_factory
        self.require_provider_keys = require_provider_keys
        self.active: dict[str, asyncio.Task[None]] = {}
        self.run_projects: dict[str, str] = {}

    def start(self, project_id: str) -> str:
        config = self.projects.load_config(project_id)
        if self.require_provider_keys:
            self._require_provider_keys(config)
        orchestrator = Orchestrator(
            config,
            self.provider_factory(),
            self.runs_root,
        )
        self.run_projects[orchestrator.run_id] = project_id
        self.active[orchestrator.run_id] = asyncio.create_task(
            self._complete(project_id, config, orchestrator.run())
        )
        return orchestrator.run_id

    def resume(self, project_id: str, run_id: str, decision: str, feedback: str) -> None:
        config = self.projects.load_config(project_id)
        if self.require_provider_keys:
            self._require_provider_keys(config)
        current = self.state(run_id)
        if current.get("status") != WorkflowStatus.APPROVAL_REQUIRED:
            raise ValueError("Run is not waiting for build approval")
        if Path(current.get("repository", "")).resolve() != config.repository.resolve():
            raise ValueError("Run does not belong to this project")
        orchestrator = Orchestrator(
            config,
            self.provider_factory(),
            self.runs_root,
            run_id=run_id,
        )
        self.run_projects[run_id] = project_id
        self.active[run_id] = asyncio.create_task(
            self._complete(project_id, config, orchestrator.resume(decision, feedback))
        )

    async def _complete(self, project_id: str, config: ProjectConfig, operation: Any) -> None:
        state = await operation
        if state.status in {WorkflowStatus.ACCEPTED, WorkflowStatus.ACCEPTED_WITH_NOTES}:
            self.registry.accept(project_id, config, state)

    def state(self, run_id: str) -> dict[str, Any]:
        state_path = self.runs_root / run_id / "state.json"
        if state_path.is_file():
            return json.loads(state_path.read_text(encoding="utf-8"))
        if run_id in self.active:
            return {"run_id": run_id, "status": "STARTING", "stage": "ARCHITECT"}
        raise FileNotFoundError(f"Unknown run: {run_id}")

    def _require_provider_keys(self, config: ProjectConfig) -> None:
        providers = {
            config.models.architect.provider,
            config.models.builder.provider,
            config.models.reviewer.provider,
        }
        if config.image_generation.enabled and config.image_generation.provider:
            providers.add(config.image_generation.provider)
        missing = [
            PROVIDER_KEYS.get(provider, f"{provider.upper().replace('-', '_')}_API_KEY")
            for provider in providers
            if not os.getenv(PROVIDER_KEYS.get(provider, f"{provider.upper().replace('-', '_')}_API_KEY"))
        ]
        if missing:
            raise ValueError("Configure backend environment variables: " + ", ".join(sorted(missing)))


def create_app(
    data_root: Path | None = None,
    runs_root: Path | None = None,
    provider_factory: Callable[[], AgentProvider] | None = None,
) -> FastAPI:
    data = (data_root or Path(os.getenv("WEB_PALACE_DATA_DIR", PACKAGE_ROOT / "data"))).resolve()
    runs = (runs_root or Path(os.getenv("WEB_PALACE_RUNS_DIR", PACKAGE_ROOT / "runs"))).resolve()
    projects = ProjectStore(data)
    registry = PalaceRegistry(data / "palaces.json")
    live_provider_factory = provider_factory or (lambda: LangChainAgentProvider(PACKAGE_ROOT / "prompts"))
    manager = RunManager(
        projects,
        runs,
        registry,
        live_provider_factory,
        require_provider_keys=provider_factory is None,
    )

    application = FastAPI(title="Web Palace Agent API", version="0.2.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    application.state.projects = projects
    application.state.manager = manager
    application.state.registry = registry

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "web-palace-agent"}

    @application.get("/api/providers", response_model=list[ProviderStatus])
    def provider_statuses() -> list[ProviderStatus]:
        return [
            ProviderStatus(
                id=provider,
                label={"openai": "OpenAI", "anthropic": "Anthropic", "deepseek": "DeepSeek"}[provider],
                configured=bool(os.getenv(variable)),
                environment_variable=variable,
            )
            for provider, variable in PROVIDER_KEYS.items()
        ]

    @application.post("/api/projects", response_model=ProjectResponse, status_code=201)
    def create_project(request: ProjectRequest) -> ProjectResponse:
        try:
            config = ProjectConfig(
                **request.model_dump(),
                repository=data / "pending",
            )
            return _project_response(projects.create(config), config)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @application.get("/api/projects", response_model=list[ProjectResponse])
    def list_projects() -> list[ProjectResponse]:
        return [_project_response(record, projects.load_config(record.id)) for record in projects.list()]

    @application.post("/api/projects/{project_id}/sources", response_model=SourceRecord, status_code=201)
    def upload_source(project_id: str, file: UploadFile = File(...)) -> SourceRecord:
        try:
            return projects.add_source(project_id, file.filename or "source", file.file)
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @application.post("/api/projects/{project_id}/runs", status_code=202)
    async def start_run(project_id: str) -> dict[str, str]:
        try:
            return {"run_id": manager.start(project_id)}
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @application.get("/api/runs/{run_id}")
    def run_state(run_id: str) -> dict[str, Any]:
        try:
            return manager.state(run_id)
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @application.post("/api/projects/{project_id}/runs/{run_id}/resume", status_code=202)
    async def resume_run(project_id: str, run_id: str, request: ResumeRequest) -> dict[str, str]:
        if request.decision not in {"approve", "revise", "reject"}:
            raise HTTPException(status_code=422, detail="Decision must be approve, revise, or reject")
        try:
            manager.resume(project_id, run_id, request.decision, request.feedback)
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return {"run_id": run_id, "status": "resuming"}

    @application.get("/api/runs/{run_id}/events")
    async def stream_events(run_id: str) -> StreamingResponse:
        directory = runs / run_id
        if not directory.is_dir() and run_id not in manager.active:
            raise HTTPException(status_code=404, detail=f"Unknown run: {run_id}")

        async def generate():
            delivered = 0
            while True:
                path = directory / "events.jsonl"
                if path.is_file():
                    lines = path.read_text(encoding="utf-8").splitlines()
                    for line in lines[delivered:]:
                        yield f"data: {line}\n\n"
                    delivered = len(lines)
                try:
                    state = manager.state(run_id)
                except FileNotFoundError:
                    state = {"status": "STARTING"}
                yield f"event: state\ndata: {json.dumps(state)}\n\n"
                if state.get("status") in {status.value for status in TERMINAL_STATUSES}:
                    break
                await asyncio.sleep(0.75)

        return StreamingResponse(generate(), media_type="text/event-stream")

    @application.get("/api/runs/{run_id}/download")
    def download_output(run_id: str) -> StreamingResponse:
        project_id = manager.run_projects.get(run_id)
        if project_id is None:
            for palace in registry.list():
                if palace.run_id == run_id:
                    project_id = palace.id
                    break
        if project_id is None:
            raise HTTPException(status_code=404, detail="Run output is not registered")
        repository = projects.load_config(project_id).repository
        archive = _zip_repository(repository)
        return StreamingResponse(
            archive,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{project_id}.zip"'},
        )

    @application.get("/api/palaces", response_model=list[PalaceRecord])
    def list_palaces() -> list[PalaceRecord]:
        return registry.list()

    return application


def _project_response(record: ProjectRecord, config: ProjectConfig) -> ProjectResponse:
    return ProjectResponse(
        id=record.id,
        project_name=config.project_name,
        subject=config.subject,
        created_at=record.created_at.isoformat(),
        sources=[{"name": item.name, "kind": item.kind, "size": item.size} for item in record.sources],
    )


def _zip_repository(repository: Path) -> io.BytesIO:
    archive = io.BytesIO()
    excluded = {".git", "node_modules", ".next", "__pycache__"}
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in repository.rglob("*"):
            relative = path.relative_to(repository)
            if path.is_file() and not any(part in excluded for part in relative.parts):
                bundle.write(path, relative.as_posix())
    archive.seek(0)
    return archive


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run("web_palace_agent.api:app", host="127.0.0.1", port=8000, reload=False)
