from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

from .schemas import ProjectConfig, WorkflowState


class PalaceRecord(BaseModel):
    id: str
    title: str
    subject: str
    audience: str
    summary: str
    run_id: str
    repository: Path
    status: str = "accepted"
    accepted_at: datetime


class PalaceRegistry:
    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def list(self) -> list[PalaceRecord]:
        if not self.path.is_file():
            return []
        return [PalaceRecord.model_validate(item) for item in json.loads(self.path.read_text(encoding="utf-8"))]

    def accept(self, project_id: str, config: ProjectConfig, state: WorkflowState) -> PalaceRecord:
        palace = PalaceRecord(
            id=project_id,
            title=config.project_name,
            subject=config.subject,
            audience=config.audience,
            summary=state.message or config.objective,
            run_id=state.run_id,
            repository=config.repository,
            accepted_at=datetime.now(UTC),
        )
        records = [item for item in self.list() if item.id != project_id]
        records.append(palace)
        self.path.write_text(
            json.dumps([item.model_dump(mode="json") for item in records], indent=2),
            encoding="utf-8",
        )
        return palace
