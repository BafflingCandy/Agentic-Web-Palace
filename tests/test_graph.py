from pathlib import Path

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from web_palace_agent.images import ImageGenerator
from web_palace_agent.orchestrator import Orchestrator, build_workflow_graph
from web_palace_agent.providers import AgentProvider
from web_palace_agent.schemas import (
    ArchitectureResult,
    BuildResult,
    DocumentArtifact,
    FileChange,
    Finding,
    GeneratedAsset,
    ImageGenerationSettings,
    ImageRequest,
    ModelSettings,
    ProjectConfig,
    ReviewDecision,
    ReviewResult,
    SpecialistModels,
    UsageRecord,
    WorkflowState,
    WorkflowStatus,
)
from web_palace_agent.storage import RunStore
from web_palace_agent.workspace import Workspace


def project_config(
    repository: Path,
    maximum_build_iterations: int = 3,
    require_build_approval: bool = False,
    maximum_model_calls: int = 12,
) -> ProjectConfig:
    model = ModelSettings(provider="offline", model="fake")
    return ProjectConfig(
        project_name="graph-test",
        subject="Feedback loops",
        audience="Developer",
        objective="Verify LangGraph routing",
        repository=repository,
        maximum_build_iterations=maximum_build_iterations,
        maximum_architecture_revisions=1,
        maximum_model_calls=maximum_model_calls,
        require_build_approval=require_build_approval,
        models=SpecialistModels(architect=model, builder=model, reviewer=model),
    )


def architecture() -> ArchitectureResult:
    names = ["SOURCE_LEDGER", "KNOWLEDGE_MODEL", "EXPERIENCE_SPEC", "CONTENT_COVERAGE", "ASSET_PLAN"]
    return ArchitectureResult(
        status="READY_FOR_BUILD",
        specification_version="1",
        artifacts=[
            DocumentArtifact(relative_path=f"docs/web-palace/{name}.md", content=f"# {name}")
            for name in names
        ],
        summary="Architecture ready",
    )


class RevisionProvider(AgentProvider):
    def __init__(self) -> None:
        self.build_calls = 0
        self.review_calls = 0

    async def architect(self, config, state, snapshot):
        return architecture()

    async def builder(self, config, state, snapshot):
        self.build_calls += 1
        return BuildResult(
            status="READY_FOR_REVIEW",
            changes=[FileChange(relative_path="site.txt", content=f"version {self.build_calls}")],
            addressed_finding_ids=list(state.open_finding_ids),
            implementation_summary="Built",
        )

    async def reviewer(self, config, state, snapshot):
        self.review_calls += 1
        if self.review_calls == 1:
            return ReviewResult(
                decision=ReviewDecision.CHANGES_REQUIRED,
                next_agent="BUILDER",
                findings=[
                    Finding(
                        id="WP-001",
                        severity="HIGH",
                        title="Needs revision",
                        evidence="version 1",
                        acceptance_condition="Produce version 2",
                    )
                ],
                summary="Revise the build",
            )
        return ReviewResult(
            decision=ReviewDecision.ACCEPT,
            next_agent="NONE",
            summary="Accepted",
        )


class PricedRevisionProvider(RevisionProvider):
    def __init__(self) -> None:
        super().__init__()
        self.pending_usage: list[UsageRecord] = []

    async def architect(self, config, state, snapshot):
        result = await super().architect(config, state, snapshot)
        self.pending_usage.append(self._record("architect"))
        return result

    async def builder(self, config, state, snapshot):
        result = await super().builder(config, state, snapshot)
        self.pending_usage.append(self._record("builder"))
        return result

    def take_usage(self, role):
        return self.pending_usage.pop(0)

    @staticmethod
    def _record(role):
        return UsageRecord(
            role=role,
            provider="offline",
            model="fake",
            total_tokens=100,
            estimated_cost_usd=0.6,
        )


class ImageRequestProvider(RevisionProvider):
    async def builder(self, config, state, snapshot):
        self.build_calls += 1
        return BuildResult(
            status="READY_FOR_REVIEW",
            changes=[FileChange(relative_path="site.txt", content="uses generated artwork")],
            images_requested=[
                ImageRequest(
                    relative_path="public/generated/hero.png",
                    prompt="A calm editorial map of a verified agent workflow with mint wayfinding",
                    purpose="Homepage teaching visual",
                )
            ],
            implementation_summary="Built with one requested visual",
        )

    async def reviewer(self, config, state, snapshot):
        return ReviewResult(decision=ReviewDecision.ACCEPT, next_agent="NONE", summary="Accepted")


class FakeImageGenerator(ImageGenerator):
    async def generate(self, requests, settings, workspace):
        workspace.write_binary(requests[0].relative_path, b"fake-png")
        return [
            GeneratedAsset(
                relative_path=requests[0].relative_path,
                purpose=requests[0].purpose,
                provider="offline",
                model="fake-image",
                estimated_cost_usd=0.04,
            )
        ]


async def run_graph(tmp_path: Path, provider: AgentProvider, maximum_build_iterations: int = 3):
    repository = tmp_path / "workspace"
    config = project_config(repository, maximum_build_iterations)
    store = RunStore(tmp_path / "runs", "test-run")
    graph = build_workflow_graph(
        config,
        provider,
        Workspace(repository, []),
        store,
        InMemorySaver(),
    )
    initial = WorkflowState(run_id="test-run", project_name=config.project_name, repository=repository)
    result = await graph.ainvoke(
        initial.model_dump(), config={"configurable": {"thread_id": "test-run"}}
    )
    return WorkflowState.model_validate(result)


@pytest.mark.asyncio
async def test_reviewer_feedback_loops_to_builder_then_accepts(tmp_path):
    provider = RevisionProvider()
    state = await run_graph(tmp_path, provider)

    assert state.status == WorkflowStatus.ACCEPTED
    assert state.build_iteration == 2
    assert state.review_iteration == 2
    assert provider.build_calls == 2
    assert (tmp_path / "workspace" / "site.txt").read_text(encoding="utf-8") == "version 2"


@pytest.mark.asyncio
async def test_graph_stops_at_build_iteration_limit(tmp_path):
    provider = RevisionProvider()
    state = await run_graph(tmp_path, provider, maximum_build_iterations=1)

    assert state.status == WorkflowStatus.ITERATION_LIMIT_REACHED
    assert state.build_iteration == 1
    assert provider.build_calls == 1


@pytest.mark.asyncio
async def test_orchestrator_persists_sqlite_checkpoints(tmp_path):
    config = project_config(tmp_path / "workspace")
    orchestrator = Orchestrator(config, RevisionProvider(), tmp_path / "runs")

    state = await orchestrator.run()

    assert state.status == WorkflowStatus.ACCEPTED
    assert (orchestrator.store.directory / "checkpoints.sqlite").is_file()
    assert (orchestrator.store.directory / "state.json").is_file()


@pytest.mark.asyncio
async def test_build_changes_wait_for_human_approval_and_resume(tmp_path):
    repository = tmp_path / "workspace"
    config = project_config(repository, require_build_approval=True)
    orchestrator = Orchestrator(config, RevisionProvider(), tmp_path / "runs")

    paused = await orchestrator.run()

    assert paused.status == WorkflowStatus.APPROVAL_REQUIRED
    assert not (repository / "site.txt").exists()

    resumed = await orchestrator.resume("approve")

    assert (repository / "site.txt").read_text(encoding="utf-8") == "version 1"
    assert resumed.status == WorkflowStatus.APPROVAL_REQUIRED


@pytest.mark.asyncio
async def test_graph_stops_before_exceeding_model_call_limit(tmp_path):
    repository = tmp_path / "workspace"
    config = project_config(repository, maximum_model_calls=3)
    provider = RevisionProvider()
    store = RunStore(tmp_path / "runs", "call-limit-run")
    graph = build_workflow_graph(config, provider, Workspace(repository, []), store)
    initial = WorkflowState(
        run_id="call-limit-run", project_name=config.project_name, repository=repository
    )

    result = await graph.ainvoke(initial.model_dump())
    state = WorkflowState.model_validate(result)

    assert state.status == WorkflowStatus.MODEL_CALL_LIMIT_REACHED
    assert state.model_calls == 3
    assert provider.build_calls == 1


@pytest.mark.asyncio
async def test_graph_stops_when_reported_cost_crosses_limit(tmp_path):
    repository = tmp_path / "workspace"
    config = project_config(repository).model_copy(
        update={"maximum_estimated_cost_usd": 1.0}
    )
    provider = PricedRevisionProvider()
    store = RunStore(tmp_path / "runs", "cost-limit-run")
    graph = build_workflow_graph(config, provider, Workspace(repository, []), store)
    initial = WorkflowState(
        run_id="cost-limit-run", project_name=config.project_name, repository=repository
    )

    result = await graph.ainvoke(initial.model_dump())
    state = WorkflowState.model_validate(result)

    assert state.status == WorkflowStatus.COST_LIMIT_REACHED
    assert state.model_calls == 2
    assert state.estimated_cost_usd == pytest.approx(1.2)
    assert not (repository / "site.txt").exists()


@pytest.mark.asyncio
async def test_approved_image_requests_generate_before_build_is_applied(tmp_path):
    repository = tmp_path / "workspace"
    config = project_config(repository).model_copy(
        update={
            "image_generation": ImageGenerationSettings(
                enabled=True,
                provider="openai",
                model="gpt-image-1.5",
                require_approval=False,
                estimated_cost_per_image=0.04,
            )
        }
    )
    store = RunStore(tmp_path / "runs", "image-run")
    graph = build_workflow_graph(
        config,
        ImageRequestProvider(),
        Workspace(repository, []),
        store,
        image_generator=FakeImageGenerator(),
    )
    initial = WorkflowState(run_id="image-run", project_name=config.project_name, repository=repository)

    result = await graph.ainvoke(initial.model_dump())
    state = WorkflowState.model_validate(result)

    assert state.status == WorkflowStatus.ACCEPTED
    assert state.image_calls == 1
    assert state.estimated_cost_usd == pytest.approx(0.04)
    assert (repository / "public/generated/hero.png").read_bytes() == b"fake-png"
    assert (repository / "site.txt").read_text(encoding="utf-8") == "uses generated artwork"
