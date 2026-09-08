import pytest
from pydantic import ValidationError

from web_palace_agent.schemas import DocumentArtifact, Finding, ReviewDecision, ReviewResult


def test_artifacts_cannot_escape_workspace():
    with pytest.raises(ValidationError):
        DocumentArtifact(relative_path="../outside.txt", content="unsafe")


def test_review_decision_must_match_next_agent():
    with pytest.raises(ValidationError):
        ReviewResult(
            decision=ReviewDecision.CHANGES_REQUIRED,
            next_agent="NONE",
            findings=[],
            summary="Invalid route",
        )


def test_accept_cannot_hide_open_high_finding():
    with pytest.raises(ValidationError):
        ReviewResult(
            decision=ReviewDecision.ACCEPT,
            next_agent="NONE",
            findings=[
                Finding(
                    id="WP-HIGH-001",
                    severity="HIGH",
                    title="Still broken",
                    evidence="Evidence",
                    acceptance_condition="Fix it",
                )
            ],
            summary="Incorrect acceptance",
        )


def test_project_config_keeps_role_models_provider_neutral():
    from web_palace_agent.schemas import ModelSettings, ProjectConfig, SpecialistModels

    config = ProjectConfig(
        project_name="real-project",
        subject="Agent orchestration",
        audience="Developer",
        objective="Run a verified workflow",
        repository="workspace",
        models=SpecialistModels(
            architect=ModelSettings(provider="anthropic", model="architect-model"),
            builder=ModelSettings(provider="openai", model="builder-model"),
            reviewer=ModelSettings(provider="deepseek", model="reviewer-model"),
        ),
    )

    assert config.models.architect.provider == "anthropic"
    assert config.models.builder.provider == "openai"
    assert config.models.reviewer.provider == "deepseek"
