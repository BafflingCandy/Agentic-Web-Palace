from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class WorkflowStage(StrEnum):
    ARCHITECT = "ARCHITECT"
    BUILD = "BUILD"
    BUILD_APPROVAL = "BUILD_APPROVAL"
    GENERATE_ASSETS = "GENERATE_ASSETS"
    APPLY_BUILD = "APPLY_BUILD"
    REVIEW = "REVIEW"
    ACCEPTED = "ACCEPTED"
    HUMAN_INPUT = "HUMAN_INPUT"
    FAILED = "FAILED"


class WorkflowStatus(StrEnum):
    RUNNING = "RUNNING"
    ACCEPTED = "ACCEPTED"
    ACCEPTED_WITH_NOTES = "ACCEPTED_WITH_NOTES"
    NEEDS_HUMAN_INPUT = "NEEDS_HUMAN_INPUT"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    ITERATION_LIMIT_REACHED = "ITERATION_LIMIT_REACHED"
    MODEL_CALL_LIMIT_REACHED = "MODEL_CALL_LIMIT_REACHED"
    COST_LIMIT_REACHED = "COST_LIMIT_REACHED"
    WORKFLOW_FAILED = "WORKFLOW_FAILED"


class ReviewDecision(StrEnum):
    ACCEPT = "ACCEPT"
    ACCEPT_WITH_LOW_RISK_NOTES = "ACCEPT_WITH_LOW_RISK_NOTES"
    CHANGES_REQUIRED = "CHANGES_REQUIRED"
    REJECT_AND_REARCHITECT = "REJECT_AND_REARCHITECT"
    REVIEW_BLOCKED = "REVIEW_BLOCKED"


class FindingStatus(StrEnum):
    OPEN = "OPEN"
    RESOLVED_PENDING_VERIFICATION = "RESOLVED_PENDING_VERIFICATION"
    VERIFIED = "VERIFIED"


class ModelSettings(BaseModel):
    """One provider-neutral LangChain chat-model configuration."""

    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1)
    input_cost_per_million: float | None = Field(default=None, ge=0)
    cached_input_cost_per_million: float | None = Field(default=None, ge=0)
    output_cost_per_million: float | None = Field(default=None, ge=0)

    @property
    def has_pricing(self) -> bool:
        return self.input_cost_per_million is not None and self.output_cost_per_million is not None


class SpecialistModels(BaseModel):
    architect: ModelSettings
    builder: ModelSettings
    reviewer: ModelSettings


class ImageGenerationSettings(BaseModel):
    enabled: bool = False
    provider: str | None = None
    model: str | None = None
    maximum_images: int = Field(default=6, ge=1, le=20)
    require_approval: bool = True
    estimated_cost_per_image: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def enabled_generation_requires_provider_and_model(self) -> "ImageGenerationSettings":
        if self.enabled and (not self.provider or not self.model):
            raise ValueError("Enabled image generation requires a provider and model")
        if self.enabled and self.provider != "openai":
            raise ValueError("The current image-generation adapter supports provider 'openai' only")
        return self


class ProjectConfig(BaseModel):
    project_name: str
    subject: str
    audience: str
    objective: str
    requirements: str = ""
    repository: Path
    source_paths: list[Path] = Field(default_factory=list)
    maximum_build_iterations: int = Field(default=3, ge=1, le=10)
    maximum_architecture_revisions: int = Field(default=1, ge=0, le=5)
    maximum_model_calls: int = Field(default=12, ge=3, le=100)
    maximum_estimated_cost_usd: float | None = Field(default=None, gt=0)
    require_build_approval: bool = True
    command_timeout_seconds: int = Field(default=120, ge=1, le=1800)
    maximum_command_output_characters: int = Field(default=4000, ge=200, le=100_000)
    models: SpecialistModels
    image_generation: ImageGenerationSettings = Field(default_factory=ImageGenerationSettings)
    allowed_commands: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def cost_limit_requires_pricing(self) -> "ProjectConfig":
        if self.maximum_estimated_cost_usd is not None:
            missing = [
                role
                for role, settings in self.models
                if not settings.has_pricing
            ]
            if missing:
                raise ValueError(
                    "maximum_estimated_cost_usd requires input and output pricing for: "
                    + ", ".join(missing)
                )
            if self.image_generation.enabled and self.image_generation.estimated_cost_per_image is None:
                raise ValueError(
                    "maximum_estimated_cost_usd requires estimated_cost_per_image when image generation is enabled"
                )
        return self


class DocumentArtifact(BaseModel):
    relative_path: str
    content: str

    @model_validator(mode="after")
    def require_safe_relative_path(self) -> "DocumentArtifact":
        path = Path(self.relative_path)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Artifact paths must be safe and repository-relative")
        return self


class ArchitectureResult(BaseModel):
    status: Literal["READY_FOR_BUILD", "NEEDS_HUMAN_INPUT", "FAILED"]
    specification_version: str
    artifacts: list[DocumentArtifact]
    unresolved_decisions: list[str] = Field(default_factory=list)
    summary: str


class FileChange(BaseModel):
    relative_path: str
    content: str

    @model_validator(mode="after")
    def require_safe_relative_path(self) -> "FileChange":
        path = Path(self.relative_path)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("File changes must be safe and repository-relative")
        return self


class ImageRequest(BaseModel):
    relative_path: str
    prompt: str = Field(min_length=20, max_length=8000)
    purpose: str = Field(min_length=3, max_length=500)
    size: Literal["1024x1024", "1536x1024", "1024x1536"] = "1536x1024"

    @model_validator(mode="after")
    def require_safe_image_path(self) -> "ImageRequest":
        path = Path(self.relative_path)
        if path.is_absolute() or ".." in path.parts or path.suffix.lower() != ".png":
            raise ValueError("Generated image paths must be safe repository-relative PNG paths")
        return self


class BuildResult(BaseModel):
    status: Literal["READY_FOR_REVIEW", "NEEDS_HUMAN_INPUT", "BUILD_FAILED"]
    changes: list[FileChange]
    commands_requested: list[str] = Field(default_factory=list)
    images_requested: list[ImageRequest] = Field(default_factory=list)
    addressed_finding_ids: list[str] = Field(default_factory=list)
    implementation_summary: str


class Finding(BaseModel):
    id: str
    severity: Literal["BLOCKER", "HIGH", "MEDIUM", "LOW"]
    title: str
    evidence: str
    acceptance_condition: str
    status: FindingStatus = FindingStatus.OPEN


class ReviewResult(BaseModel):
    decision: ReviewDecision
    next_agent: Literal["NONE", "BUILDER", "ARCHITECT", "HUMAN"]
    findings: list[Finding] = Field(default_factory=list)
    artifacts: list[DocumentArtifact] = Field(default_factory=list)
    summary: str

    @model_validator(mode="after")
    def decision_matches_route(self) -> "ReviewResult":
        expected = {
            ReviewDecision.ACCEPT: "NONE",
            ReviewDecision.ACCEPT_WITH_LOW_RISK_NOTES: "NONE",
            ReviewDecision.CHANGES_REQUIRED: "BUILDER",
            ReviewDecision.REJECT_AND_REARCHITECT: "ARCHITECT",
            ReviewDecision.REVIEW_BLOCKED: "HUMAN",
        }
        if self.next_agent != expected[self.decision]:
            raise ValueError(
                f"{self.decision} must route to {expected[self.decision]}, "
                f"not {self.next_agent}"
            )
        if self.decision in {ReviewDecision.ACCEPT, ReviewDecision.ACCEPT_WITH_LOW_RISK_NOTES}:
            serious = [f.id for f in self.findings if f.status == FindingStatus.OPEN and f.severity in {"BLOCKER", "HIGH"}]
            if serious:
                raise ValueError(f"An accepted review cannot contain open serious findings: {serious}")
        return self


class UsageRecord(BaseModel):
    role: Literal["architect", "builder", "reviewer"]
    provider: str
    model: str
    input_tokens: int = Field(default=0, ge=0)
    cached_input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)
    estimated_cost_usd: float | None = Field(default=None, ge=0)


class GeneratedAsset(BaseModel):
    relative_path: str
    purpose: str
    provider: str
    model: str
    estimated_cost_usd: float | None = Field(default=None, ge=0)


class WorkflowState(BaseModel):
    run_id: str
    project_name: str
    repository: Path
    stage: WorkflowStage = WorkflowStage.ARCHITECT
    status: WorkflowStatus = WorkflowStatus.RUNNING
    architecture_revision: int = 0
    build_iteration: int = 0
    review_iteration: int = 0
    specification_version: str | None = None
    open_finding_ids: list[str] = Field(default_factory=list)
    repeated_finding_counts: dict[str, int] = Field(default_factory=dict)
    architecture_result: ArchitectureResult | None = None
    build_result: BuildResult | None = None
    review_result: ReviewResult | None = None
    command_results: list[dict[str, Any]] = Field(default_factory=list)
    model_calls: int = 0
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    usage_records: list[UsageRecord] = Field(default_factory=list)
    approval_feedback: str = ""
    generated_assets: list[GeneratedAsset] = Field(default_factory=list)
    image_calls: int = 0
    message: str = ""
