import pytest

from web_palace_agent.routing import next_stage
from web_palace_agent.schemas import ReviewDecision, WorkflowStage


@pytest.mark.parametrize(
    ("decision", "stage"),
    [
        (ReviewDecision.ACCEPT, WorkflowStage.ACCEPTED),
        (ReviewDecision.ACCEPT_WITH_LOW_RISK_NOTES, WorkflowStage.ACCEPTED),
        (ReviewDecision.CHANGES_REQUIRED, WorkflowStage.BUILD),
        (ReviewDecision.REJECT_AND_REARCHITECT, WorkflowStage.ARCHITECT),
        (ReviewDecision.REVIEW_BLOCKED, WorkflowStage.HUMAN_INPUT),
    ],
)
def test_review_decisions_have_deterministic_routes(decision, stage):
    assert next_stage(decision) == stage

