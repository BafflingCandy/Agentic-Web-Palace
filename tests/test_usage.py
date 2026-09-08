import pytest
from pydantic import ValidationError

from web_palace_agent.providers import _usage_record
from web_palace_agent.schemas import ModelSettings, ProjectConfig, SpecialistModels


def test_usage_record_calculates_cached_and_uncached_cost():
    settings = ModelSettings(
        provider="example",
        model="priced-model",
        input_cost_per_million=2,
        cached_input_cost_per_million=0.2,
        output_cost_per_million=12,
    )

    record = _usage_record(
        "builder",
        settings,
        {
            "input_tokens": 10_000,
            "output_tokens": 2_000,
            "total_tokens": 12_000,
            "input_token_details": {"cache_read": 4_000},
        },
    )

    assert record.cached_input_tokens == 4_000
    assert record.estimated_cost_usd == pytest.approx(0.0368)


def test_cost_limit_requires_pricing_for_every_role(tmp_path):
    model = ModelSettings(provider="offline", model="unpriced")

    with pytest.raises(ValidationError, match="requires input and output pricing"):
        ProjectConfig(
            project_name="invalid-budget",
            subject="Cost controls",
            audience="Developer",
            objective="Reject unpriced cost limits",
            repository=tmp_path,
            maximum_estimated_cost_usd=1,
            models=SpecialistModels(architect=model, builder=model, reviewer=model),
        )
