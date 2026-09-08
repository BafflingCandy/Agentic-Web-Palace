from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable, TypeVar

from pydantic import BaseModel

from .schemas import (
    ArchitectureResult,
    BuildResult,
    ModelSettings,
    ProjectConfig,
    ReviewResult,
    UsageRecord,
    WorkflowState,
)

OutputT = TypeVar("OutputT", bound=BaseModel)
ModelFactory = Callable[[ModelSettings], Any]


class AgentProvider(ABC):
    """Provider-neutral boundary used by LangGraph nodes and offline fakes."""

    @abstractmethod
    async def architect(self, config: ProjectConfig, state: WorkflowState, snapshot: str) -> ArchitectureResult: ...

    @abstractmethod
    async def builder(self, config: ProjectConfig, state: WorkflowState, snapshot: str) -> BuildResult: ...

    @abstractmethod
    async def reviewer(self, config: ProjectConfig, state: WorkflowState, snapshot: str) -> ReviewResult: ...

    def take_usage(self, role: str) -> UsageRecord | None:
        """Return usage for the most recent role call; offline providers return none."""

        return None


class PromptRepository:
    """Compose the shared Web Palace brain with one specialist contract."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def for_role(self, role: str) -> str:
        files = [
            self.directory / "shared" / "web_palace_brain.md",
            self.directory / "shared" / "source_grounding.md",
            self.directory / "shared" / "safety_policy.md",
            self.directory / f"{role}.md",
        ]
        return "\n\n---\n\n".join(path.read_text(encoding="utf-8") for path in files)


def create_chat_model(settings: ModelSettings) -> Any:
    """Create a LangChain model without leaking provider details into graph nodes."""

    try:
        from langchain.chat_models import init_chat_model
    except ImportError as error:
        raise RuntimeError("Install the project dependencies before running live models") from error

    options: dict[str, Any] = {}
    if settings.temperature is not None:
        options["temperature"] = settings.temperature
    if settings.max_tokens is not None:
        options["max_tokens"] = settings.max_tokens
    return init_chat_model(model=settings.model, model_provider=settings.provider, **options)


class LangChainAgentProvider(AgentProvider):
    """LangChain structured-output adapter for interchangeable model providers."""

    def __init__(self, prompt_directory: Path, model_factory: ModelFactory = create_chat_model) -> None:
        self.prompts = PromptRepository(prompt_directory)
        self.model_factory = model_factory
        self._models: dict[tuple[str, str, float | None, int | None], Any] = {}
        self._usage: list[UsageRecord] = []

    def _model(self, settings: ModelSettings) -> Any:
        key = (settings.provider, settings.model, settings.temperature, settings.max_tokens)
        if key not in self._models:
            self._models[key] = self.model_factory(settings)
        return self._models[key]

    async def _run(
        self, role: str, settings: ModelSettings, output_type: type[OutputT], task: str
    ) -> OutputT:
        try:
            from langchain_core.messages import HumanMessage, SystemMessage
        except ImportError as error:
            raise RuntimeError("Install the project dependencies before running live models") from error

        structured_model = self._model(settings).with_structured_output(output_type, include_raw=True)
        response = await structured_model.ainvoke(
            [SystemMessage(content=self.prompts.for_role(role)), HumanMessage(content=task)]
        )
        raw = response["raw"]
        result = response["parsed"]
        if result is None:
            raise ValueError(f"{role} returned invalid structured output: {response['parsing_error']}")
        self._usage.append(_usage_record(role, settings, getattr(raw, "usage_metadata", None)))
        return result if isinstance(result, output_type) else output_type.model_validate(result)

    def take_usage(self, role: str) -> UsageRecord | None:
        for index, record in enumerate(self._usage):
            if record.role == role:
                return self._usage.pop(index)
        return None

    async def architect(self, config: ProjectConfig, state: WorkflowState, snapshot: str) -> ArchitectureResult:
        return await self._run("architect", config.models.architect, ArchitectureResult, _task(config, state, snapshot))

    async def builder(self, config: ProjectConfig, state: WorkflowState, snapshot: str) -> BuildResult:
        return await self._run("builder", config.models.builder, BuildResult, _task(config, state, snapshot))

    async def reviewer(self, config: ProjectConfig, state: WorkflowState, snapshot: str) -> ReviewResult:
        return await self._run("reviewer", config.models.reviewer, ReviewResult, _task(config, state, snapshot))


def _source_context(config: ProjectConfig, maximum_characters: int = 40_000) -> str:
    sections: list[str] = []
    used = 0
    for path in config.source_paths:
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            content = f"(source unavailable: {type(error).__name__}: {error})"
        block = f"\n--- SOURCE: {path.name} ---\n{content}"
        remaining = maximum_characters - used
        if remaining <= 0:
            break
        sections.append(block[:remaining])
        used += min(len(block), remaining)
    return "".join(sections) or "(no external source files supplied)"


def _task(config: ProjectConfig, state: WorkflowState, snapshot: str) -> str:
    prior_review = (
        state.review_result.model_dump_json(indent=2)
        if state.review_result is not None
        else "(no prior review)"
    )
    return (
        f"Project: {config.project_name}\nSubject: {config.subject}\nAudience: {config.audience}\n"
        f"Objective: {config.objective}\nUser requirements: {config.requirements or '(none)'}\n"
        f"Image generation: {config.image_generation.model_dump_json()}\nStage: {state.stage}\n"
        f"Architecture calls: {state.architecture_revision}\nBuild iteration: {state.build_iteration}\n"
        f"Open findings: {state.open_finding_ids}\n"
        f"Human approval feedback: {state.approval_feedback or '(none)'}\n"
        f"Latest command evidence: {state.command_results}\n\nPRIOR REVIEW FEEDBACK:\n{prior_review}\n\n"
        f"SOURCE MATERIAL:\n{_source_context(config)}"
        f"\n\nWORKSPACE SNAPSHOT:\n{snapshot}"
    )


def _usage_record(role: str, settings: ModelSettings, metadata: Any) -> UsageRecord:
    usage = metadata or {}
    input_tokens = int(usage.get("input_tokens", 0) or 0)
    output_tokens = int(usage.get("output_tokens", 0) or 0)
    total_tokens = int(usage.get("total_tokens", input_tokens + output_tokens) or 0)
    details = usage.get("input_token_details", {}) or {}
    cached_tokens = int(details.get("cache_read", details.get("cached_tokens", 0)) or 0)

    cost: float | None = None
    if settings.has_pricing:
        cached_rate = (
            settings.cached_input_cost_per_million
            if settings.cached_input_cost_per_million is not None
            else settings.input_cost_per_million
        )
        uncached_tokens = max(input_tokens - cached_tokens, 0)
        cost = (
            uncached_tokens * settings.input_cost_per_million
            + cached_tokens * cached_rate
            + output_tokens * settings.output_cost_per_million
        ) / 1_000_000

    return UsageRecord(
        role=role,
        provider=settings.provider,
        model=settings.model,
        input_tokens=input_tokens,
        cached_input_tokens=cached_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        estimated_cost_usd=cost,
    )
