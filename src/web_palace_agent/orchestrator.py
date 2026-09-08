from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from .images import ImageGenerator, OpenAIImageGenerator
from .providers import AgentProvider
from .schemas import (
    FindingStatus,
    ProjectConfig,
    ReviewDecision,
    WorkflowStage,
    WorkflowState,
    WorkflowStatus,
)
from .storage import RunStore
from .workspace import Workspace


class WorkflowNodes:
    """LangGraph nodes with injected model, storage, and workspace boundaries."""

    def __init__(
        self,
        config: ProjectConfig,
        provider: AgentProvider,
        workspace: Workspace,
        store: RunStore,
        image_generator: ImageGenerator,
    ) -> None:
        self.config = config
        self.provider = provider
        self.workspace = workspace
        self.store = store
        self.image_generator = image_generator

    async def architect(self, state: WorkflowState) -> dict[str, Any]:
        budget_failure = self._budget_failure(state)
        if budget_failure:
            return budget_failure
        if state.architecture_revision > self.config.maximum_architecture_revisions:
            return {
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.ITERATION_LIMIT_REACHED,
                "message": "Architecture revision limit reached.",
            }

        self.store.event("NODE_STARTED", node="architect", revision=state.architecture_revision)
        result = await self.provider.architect(self.config, state, self.workspace.snapshot())
        self.store.save_output(f"architect-{state.architecture_revision}.json", result)
        usage = self._usage_updates(state, "architect")
        if self._cost_exceeded(usage):
            return self._cost_failure(usage)

        if result.status == "NEEDS_HUMAN_INPUT":
            return {
                **usage,
                "architecture_result": result,
                "stage": WorkflowStage.HUMAN_INPUT,
                "message": "; ".join(result.unresolved_decisions),
            }
        if result.status == "FAILED":
            return {
                **usage,
                "architecture_result": result,
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.WORKFLOW_FAILED,
                "message": result.summary,
            }

        required = {
            "docs/web-palace/SOURCE_LEDGER.md",
            "docs/web-palace/KNOWLEDGE_MODEL.md",
            "docs/web-palace/EXPERIENCE_SPEC.md",
            "docs/web-palace/CONTENT_COVERAGE.md",
            "docs/web-palace/ASSET_PLAN.md",
        }
        supplied = {artifact.relative_path.replace("\\", "/") for artifact in result.artifacts}
        missing = required - supplied
        if missing:
            return {
                **usage,
                "architecture_result": result,
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.WORKFLOW_FAILED,
                "message": f"Architect omitted required artifacts: {sorted(missing)}",
            }

        self.workspace.write_artifacts(result.artifacts)
        self.store.event("NODE_COMPLETED", node="architect", next_node="builder")
        return {
            **usage,
            "architecture_result": result,
            "specification_version": result.specification_version,
            "architecture_revision": state.architecture_revision + 1,
            "stage": WorkflowStage.BUILD,
            "message": result.summary,
        }

    async def builder(self, state: WorkflowState) -> dict[str, Any]:
        budget_failure = self._budget_failure(state)
        if budget_failure:
            return budget_failure
        if state.build_iteration >= self.config.maximum_build_iterations:
            return {
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.ITERATION_LIMIT_REACHED,
                "message": "Build iteration limit reached before acceptance.",
            }

        iteration = state.build_iteration + 1
        self.store.event("NODE_STARTED", node="builder", iteration=iteration)
        result = await self.provider.builder(self.config, state, self.workspace.snapshot())
        self.store.save_output(f"builder-{iteration}.json", result)
        usage = self._usage_updates(state, "builder")
        if self._cost_exceeded(usage):
            return self._cost_failure(usage)

        if result.status == "NEEDS_HUMAN_INPUT":
            return {
                **usage,
                "build_result": result,
                "stage": WorkflowStage.HUMAN_INPUT,
                "message": result.implementation_summary,
            }
        if result.status == "BUILD_FAILED":
            return {
                **usage,
                "build_result": result,
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.WORKFLOW_FAILED,
                "message": result.implementation_summary,
            }

        self.workspace.validate_artifacts(result.changes)
        self.workspace.validate_commands(result.commands_requested)
        if result.images_requested and not self.config.image_generation.enabled:
            return {
                **usage,
                "build_result": result,
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.WORKFLOW_FAILED,
                "message": "Builder requested generated images, but image generation is disabled.",
            }
        if len(result.images_requested) > self.config.image_generation.maximum_images:
            return {
                **usage,
                "build_result": result,
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.WORKFLOW_FAILED,
                "message": "Builder exceeded the configured generated-image limit.",
            }
        approval_needed = self.config.require_build_approval or bool(
            result.images_requested and self.config.image_generation.require_approval
        )
        if approval_needed:
            next_stage = WorkflowStage.BUILD_APPROVAL
        elif result.images_requested:
            next_stage = WorkflowStage.GENERATE_ASSETS
        else:
            next_stage = WorkflowStage.APPLY_BUILD
        self.store.event("NODE_COMPLETED", node="builder", next_stage=next_stage)
        return {
            **usage,
            "build_result": result,
            "stage": next_stage,
            "message": result.implementation_summary,
        }

    def approve_build(self, state: WorkflowState) -> dict[str, Any]:
        if state.build_result is None:
            return {
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.WORKFLOW_FAILED,
                "message": "Build approval was requested without a build proposal.",
            }
        response = interrupt(
            {
                "kind": "build_approval",
                "summary": state.build_result.implementation_summary,
                "files": [change.relative_path for change in state.build_result.changes],
                "commands": state.build_result.commands_requested,
                "images": [item.model_dump() for item in state.build_result.images_requested],
                "instructions": "Resume with approve, revise, or reject and optional feedback.",
            }
        )
        decision = response.get("decision", "") if isinstance(response, dict) else str(response)
        feedback = response.get("feedback", "") if isinstance(response, dict) else ""
        if decision == "approve":
            return {
                "stage": (
                    WorkflowStage.GENERATE_ASSETS
                    if state.build_result.images_requested
                    else WorkflowStage.APPLY_BUILD
                ),
                "approval_feedback": "",
                "status": WorkflowStatus.RUNNING,
                "message": "Build proposal approved.",
            }
        if decision == "revise":
            return {
                "stage": WorkflowStage.BUILD,
                "approval_feedback": feedback or "Human requested a revised build proposal.",
                "status": WorkflowStatus.RUNNING,
                "message": feedback or "Human requested a revised build proposal.",
            }
        return {
            "stage": WorkflowStage.HUMAN_INPUT,
            "approval_feedback": feedback,
            "message": feedback or "Build proposal rejected by human reviewer.",
        }

    async def generate_assets(self, state: WorkflowState) -> dict[str, Any]:
        if state.build_result is None:
            return {
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.WORKFLOW_FAILED,
                "message": "No approved image requests are available.",
            }
        requests = state.build_result.images_requested
        projected = sum(
            self.config.image_generation.estimated_cost_per_image or 0 for _ in requests
        )
        limit = self.config.maximum_estimated_cost_usd
        if limit is not None and state.estimated_cost_usd + projected > limit:
            return {
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.COST_LIMIT_REACHED,
                "message": "Approved images would exceed the configured estimated cost limit.",
            }
        assets = await self.image_generator.generate(
            requests, self.config.image_generation, self.workspace
        )
        self.store.save_output("generated-assets.json", {"assets": [item.model_dump(mode="json") for item in assets]})
        actual_estimate = sum(item.estimated_cost_usd or 0 for item in assets)
        return {
            "generated_assets": [*state.generated_assets, *assets],
            "image_calls": state.image_calls + len(assets),
            "estimated_cost_usd": state.estimated_cost_usd + actual_estimate,
            "stage": WorkflowStage.APPLY_BUILD,
            "message": f"Generated {len(assets)} approved image assets.",
        }

    def apply_build(self, state: WorkflowState) -> dict[str, Any]:
        if state.build_result is None:
            return {
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.WORKFLOW_FAILED,
                "message": "No approved build proposal is available to apply.",
            }
        iteration = state.build_iteration + 1
        self.workspace.write_artifacts(state.build_result.changes)
        command_results = self.workspace.run_approved(state.build_result.commands_requested)
        self.store.save_output(f"commands-{iteration}.json", {"results": command_results})
        self.store.event("NODE_COMPLETED", node="apply_build", next_node="reviewer")
        return {
            "command_results": command_results,
            "build_iteration": iteration,
            "stage": WorkflowStage.REVIEW,
            "message": state.build_result.implementation_summary,
        }

    async def reviewer(self, state: WorkflowState) -> dict[str, Any]:
        budget_failure = self._budget_failure(state)
        if budget_failure:
            return budget_failure
        iteration = state.review_iteration + 1
        self.store.event("NODE_STARTED", node="reviewer", iteration=iteration)
        result = await self.provider.reviewer(self.config, state, self.workspace.snapshot())
        self.store.save_output(f"reviewer-{iteration}.json", result)
        self.workspace.write_artifacts(result.artifacts)
        usage = self._usage_updates(state, "reviewer")
        if self._cost_exceeded(usage):
            return self._cost_failure(usage)

        open_ids = [item.id for item in result.findings if item.status == FindingStatus.OPEN]
        counts = dict(state.repeated_finding_counts)
        for finding_id in open_ids:
            counts[finding_id] = counts.get(finding_id, 0) + 1

        updates: dict[str, Any] = {
            **usage,
            "review_result": result,
            "review_iteration": iteration,
            "open_finding_ids": open_ids,
            "repeated_finding_counts": counts,
            "message": result.summary,
        }
        if any(counts[finding_id] >= 3 for finding_id in open_ids):
            updates["stage"] = WorkflowStage.HUMAN_INPUT
            updates["message"] = "The same finding remained open for three reviews."
            self.store.event("HUMAN_ESCALATION", reason="repeated_finding")
        else:
            updates["stage"] = {
                ReviewDecision.ACCEPT: WorkflowStage.ACCEPTED,
                ReviewDecision.ACCEPT_WITH_LOW_RISK_NOTES: WorkflowStage.ACCEPTED,
                ReviewDecision.CHANGES_REQUIRED: WorkflowStage.BUILD,
                ReviewDecision.REJECT_AND_REARCHITECT: WorkflowStage.ARCHITECT,
                ReviewDecision.REVIEW_BLOCKED: WorkflowStage.HUMAN_INPUT,
            }[result.decision]
            if result.decision == ReviewDecision.ACCEPT_WITH_LOW_RISK_NOTES:
                updates["status"] = WorkflowStatus.ACCEPTED_WITH_NOTES

        self.store.event(
            "NODE_COMPLETED", node="reviewer", decision=result.decision, next_stage=updates["stage"]
        )
        return updates

    def _budget_failure(self, state: WorkflowState) -> dict[str, Any] | None:
        if state.model_calls >= self.config.maximum_model_calls:
            return {
                "stage": WorkflowStage.FAILED,
                "status": WorkflowStatus.MODEL_CALL_LIMIT_REACHED,
                "message": "Maximum model-call limit reached.",
            }
        if (
            self.config.maximum_estimated_cost_usd is not None
            and state.estimated_cost_usd >= self.config.maximum_estimated_cost_usd
        ):
            return self._cost_failure({})
        return None

    def _usage_updates(self, state: WorkflowState, role: str) -> dict[str, Any]:
        record = self.provider.take_usage(role)
        if record is None:
            return {"model_calls": state.model_calls + 1}
        return {
            "model_calls": state.model_calls + 1,
            "input_tokens": state.input_tokens + record.input_tokens,
            "cached_input_tokens": state.cached_input_tokens + record.cached_input_tokens,
            "output_tokens": state.output_tokens + record.output_tokens,
            "total_tokens": state.total_tokens + record.total_tokens,
            "estimated_cost_usd": state.estimated_cost_usd + (record.estimated_cost_usd or 0),
            "usage_records": [*state.usage_records, record],
        }

    def _cost_exceeded(self, updates: dict[str, Any]) -> bool:
        limit = self.config.maximum_estimated_cost_usd
        return limit is not None and updates.get("estimated_cost_usd", 0) > limit

    def _cost_failure(self, updates: dict[str, Any]) -> dict[str, Any]:
        return {
            **updates,
            "stage": WorkflowStage.FAILED,
            "status": WorkflowStatus.COST_LIMIT_REACHED,
            "message": "Configured estimated workflow cost limit reached.",
        }

    def accepted(self, state: WorkflowState) -> dict[str, Any]:
        status = (
            WorkflowStatus.ACCEPTED_WITH_NOTES
            if state.status == WorkflowStatus.ACCEPTED_WITH_NOTES
            else WorkflowStatus.ACCEPTED
        )
        return {"status": status, "stage": WorkflowStage.ACCEPTED}

    def human_input(self, state: WorkflowState) -> dict[str, Any]:
        return {"status": WorkflowStatus.NEEDS_HUMAN_INPUT, "stage": WorkflowStage.HUMAN_INPUT}

    def failed(self, state: WorkflowState) -> dict[str, Any]:
        status = state.status
        if status == WorkflowStatus.RUNNING:
            status = WorkflowStatus.WORKFLOW_FAILED
        return {"status": status, "stage": WorkflowStage.FAILED}

    def iteration_limit(self, state: WorkflowState) -> dict[str, Any]:
        if state.stage == WorkflowStage.BUILD:
            message = "Build iteration limit reached before acceptance."
        else:
            message = "Architecture revision limit reached before acceptance."
        return {
            "status": WorkflowStatus.ITERATION_LIMIT_REACHED,
            "stage": WorkflowStage.FAILED,
            "message": message,
        }


def build_workflow_graph(
    config: ProjectConfig,
    provider: AgentProvider,
    workspace: Workspace,
    store: RunStore,
    checkpointer: Any | None = None,
    image_generator: ImageGenerator | None = None,
) -> Any:
    """Build the explicit Architect → Builder → Reviewer feedback graph."""

    nodes = WorkflowNodes(
        config, provider, workspace, store, image_generator or OpenAIImageGenerator()
    )
    graph = StateGraph(WorkflowState)
    graph.add_node("architect", nodes.architect)
    graph.add_node("builder", nodes.builder)
    graph.add_node("approve_build", nodes.approve_build)
    graph.add_node("generate_assets", nodes.generate_assets)
    graph.add_node("apply_build", nodes.apply_build)
    graph.add_node("reviewer", nodes.reviewer)
    graph.add_node("accepted", nodes.accepted)
    graph.add_node("human_input", nodes.human_input)
    graph.add_node("failed", nodes.failed)
    graph.add_node("iteration_limit", nodes.iteration_limit)

    graph.add_edge(START, "architect")
    graph.add_conditional_edges("architect", _route_stage)
    graph.add_conditional_edges("builder", _route_stage)
    graph.add_conditional_edges("approve_build", _route_stage)
    graph.add_conditional_edges("generate_assets", _route_stage)
    graph.add_conditional_edges("apply_build", _route_stage)
    graph.add_conditional_edges("reviewer", lambda state: _route_review(state, config))
    graph.add_edge("accepted", END)
    graph.add_edge("human_input", END)
    graph.add_edge("failed", END)
    graph.add_edge("iteration_limit", END)
    return graph.compile(checkpointer=checkpointer)


def _route_stage(state: WorkflowState) -> str:
    return {
        WorkflowStage.BUILD: "builder",
        WorkflowStage.BUILD_APPROVAL: "approve_build",
        WorkflowStage.GENERATE_ASSETS: "generate_assets",
        WorkflowStage.APPLY_BUILD: "apply_build",
        WorkflowStage.REVIEW: "reviewer",
        WorkflowStage.ACCEPTED: "accepted",
        WorkflowStage.HUMAN_INPUT: "human_input",
        WorkflowStage.FAILED: "failed",
    }[state.stage]


def _route_review(state: WorkflowState, config: ProjectConfig) -> str:
    if state.stage == WorkflowStage.BUILD and state.build_iteration >= config.maximum_build_iterations:
        return "iteration_limit"
    if (
        state.stage == WorkflowStage.ARCHITECT
        and state.architecture_revision > config.maximum_architecture_revisions
    ):
        return "iteration_limit"
    return _route_stage(state)


class Orchestrator:
    """Runtime wrapper that gives each LangGraph execution a durable thread."""

    def __init__(
        self,
        config: ProjectConfig,
        provider: AgentProvider,
        runs_root: Path,
        run_id: str | None = None,
    ) -> None:
        self.config = config
        self.provider = provider
        self.run_id = run_id or datetime.now(UTC).strftime("run-%Y%m%d-%H%M%S-%f")
        self.store = RunStore(runs_root, self.run_id, existing=run_id is not None)
        self.workspace = Workspace(
            config.repository,
            config.allowed_commands,
            config.command_timeout_seconds,
            config.maximum_command_output_characters,
        )

    async def run(self) -> WorkflowState:
        initial = WorkflowState(
            run_id=self.run_id,
            project_name=self.config.project_name,
            repository=self.config.repository,
        )
        self.store.event("WORKFLOW_STARTED", project=self.config.project_name, engine="langgraph")
        return await self._execute(initial.model_dump())

    async def resume(self, decision: str, feedback: str = "") -> WorkflowState:
        if decision not in {"approve", "revise", "reject"}:
            raise ValueError("Decision must be approve, revise, or reject")
        self.store.event("WORKFLOW_RESUMED", decision=decision)
        return await self._execute(Command(resume={"decision": decision, "feedback": feedback}))

    async def _execute(self, graph_input: dict[str, Any] | Command) -> WorkflowState:
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        checkpoint_path = self.store.directory / "checkpoints.sqlite"
        try:
            async with AsyncSqliteSaver.from_conn_string(str(checkpoint_path)) as checkpointer:
                graph = build_workflow_graph(
                    self.config, self.provider, self.workspace, self.store, checkpointer
                )
                result = await graph.ainvoke(
                    graph_input,
                    config={"configurable": {"thread_id": self.run_id}},
                )
            interrupted = bool(result.get("__interrupt__"))
            state = WorkflowState.model_validate(result)
            if interrupted:
                state = state.model_copy(
                    update={
                        "status": WorkflowStatus.APPROVAL_REQUIRED,
                        "message": "Build proposal is waiting for human approval.",
                    }
                )
        except Exception as error:
            state = WorkflowState(
                run_id=self.run_id,
                project_name=self.config.project_name,
                repository=self.config.repository,
                stage=WorkflowStage.FAILED,
                status=WorkflowStatus.WORKFLOW_FAILED,
                message=f"{type(error).__name__}: {error}",
            )
            self.store.event("WORKFLOW_ERROR", error=state.message)

        self.store.save_state(state)
        self.store.write_final_report(state)
        event = "WORKFLOW_PAUSED" if state.status == WorkflowStatus.APPROVAL_REQUIRED else "WORKFLOW_FINISHED"
        self.store.event(event, status=state.status)
        return state
