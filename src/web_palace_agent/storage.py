from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .schemas import WorkflowState


class RunStore:
    def __init__(self, root: Path, run_id: str, *, existing: bool = False) -> None:
        self.directory = root.resolve() / run_id
        if existing:
            if not self.directory.is_dir():
                raise FileNotFoundError(f"Run does not exist: {run_id}")
        else:
            self.directory.mkdir(parents=True, exist_ok=False)
        self.events_path = self.directory / "events.jsonl"

    def save_state(self, state: WorkflowState) -> None:
        self._write_json("state.json", state)

    def save_output(self, name: str, value: BaseModel | dict[str, Any]) -> None:
        self._write_json(name, value)

    def event(self, event: str, **payload: Any) -> None:
        record = {
            "timestamp": datetime.now(UTC).isoformat(),
            "event": event,
            **payload,
        }
        with self.events_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, default=str) + "\n")

    def write_final_report(self, state: WorkflowState) -> Path:
        report = self.directory / "final-report.md"
        report.write_text(
            "\n".join(
                [
                    f"# Workflow run: {state.run_id}",
                    "",
                    f"- Project: {state.project_name}",
                    f"- Status: **{state.status}**",
                    f"- Final stage: {state.stage}",
                    f"- Architecture revisions: {state.architecture_revision}",
                    f"- Build iterations: {state.build_iteration}",
                    f"- Review iterations: {state.review_iteration}",
                    f"- Model calls: {state.model_calls}",
                    f"- Input tokens: {state.input_tokens}",
                    f"- Cached input tokens: {state.cached_input_tokens}",
                    f"- Output tokens: {state.output_tokens}",
                    f"- Total tokens: {state.total_tokens}",
                    f"- Estimated model cost: ${state.estimated_cost_usd:.6f}",
                    f"- Open findings: {', '.join(state.open_finding_ids) or 'None'}",
                    f"- Message: {state.message}",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        return report

    def _write_json(self, name: str, value: BaseModel | dict[str, Any]) -> None:
        data = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
        (self.directory / name).write_text(
            json.dumps(data, indent=2, default=str) + "\n",
            encoding="utf-8",
        )
