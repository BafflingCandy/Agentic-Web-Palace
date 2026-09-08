from .schemas import ReviewDecision, WorkflowStage


def next_stage(decision: ReviewDecision) -> WorkflowStage:
    """Map a validated review decision to the next deterministic stage."""
    return {
        ReviewDecision.ACCEPT: WorkflowStage.ACCEPTED,
        ReviewDecision.ACCEPT_WITH_LOW_RISK_NOTES: WorkflowStage.ACCEPTED,
        ReviewDecision.CHANGES_REQUIRED: WorkflowStage.BUILD,
        ReviewDecision.REJECT_AND_REARCHITECT: WorkflowStage.ARCHITECT,
        ReviewDecision.REVIEW_BLOCKED: WorkflowStage.HUMAN_INPUT,
    }[decision]

