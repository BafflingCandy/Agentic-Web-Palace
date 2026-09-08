from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO

import yaml
from docx import Document
from pydantic import BaseModel, Field
from pypdf import PdfReader

from .schemas import ProjectConfig

ALLOWED_SOURCE_SUFFIXES = {".txt", ".md", ".pdf", ".docx"}
MAXIMUM_SOURCE_BYTES = 20 * 1024 * 1024
MAXIMUM_EXTRACTED_CHARACTERS = 500_000


class SourceRecord(BaseModel):
    name: str
    kind: str
    size: int
    extracted_path: Path


class ProjectRecord(BaseModel):
    id: str
    created_at: datetime
    config_path: Path
    sources: list[SourceRecord] = Field(default_factory=list)


class ProjectStore:
    """Persistent local intake store; API keys never enter this boundary."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.projects = self.root / "projects"
        self.workspaces = self.root / "workspaces"
        self.projects.mkdir(parents=True, exist_ok=True)
        self.workspaces.mkdir(parents=True, exist_ok=True)

    def create(self, config: ProjectConfig) -> ProjectRecord:
        project_id = self._available_id(config.project_name)
        directory = self.projects / project_id
        directory.mkdir(parents=True)
        (directory / "sources").mkdir()
        (directory / "extracted").mkdir()
        config.repository = (self.workspaces / project_id).resolve()
        config.repository.mkdir(parents=True, exist_ok=True)
        record = ProjectRecord(
            id=project_id,
            created_at=datetime.now(UTC),
            config_path=directory / "project.yaml",
        )
        self._save_config(config, record.config_path)
        self._save_record(record)
        return record

    def add_source(self, project_id: str, filename: str, stream: BinaryIO) -> SourceRecord:
        record = self.get(project_id)
        safe_name = Path(filename).name
        suffix = Path(safe_name).suffix.lower()
        if suffix not in ALLOWED_SOURCE_SUFFIXES:
            raise ValueError(f"Unsupported source type: {suffix or 'none'}")
        data = stream.read(MAXIMUM_SOURCE_BYTES + 1)
        if len(data) > MAXIMUM_SOURCE_BYTES:
            raise ValueError("Source exceeds the 20 MB upload limit")
        directory = record.config_path.parent
        source_path = directory / "sources" / safe_name
        source_path.write_bytes(data)
        extracted_path = directory / "extracted" / f"{source_path.stem}-{suffix.removeprefix('.')}.txt"
        extracted_path.write_text(self._extract(source_path, suffix), encoding="utf-8")
        source = SourceRecord(
            name=safe_name,
            kind=suffix.removeprefix("."),
            size=len(data),
            extracted_path=extracted_path,
        )
        record.sources = [item for item in record.sources if item.name != safe_name]
        record.sources.append(source)
        config = self.load_config(project_id)
        config.source_paths = [item.extracted_path for item in record.sources]
        self._save_config(config, record.config_path)
        self._save_record(record)
        return source

    def get(self, project_id: str) -> ProjectRecord:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", project_id):
            raise FileNotFoundError(f"Unknown project: {project_id}")
        path = self.projects / project_id / "project.json"
        if not path.is_file():
            raise FileNotFoundError(f"Unknown project: {project_id}")
        return ProjectRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def list(self) -> list[ProjectRecord]:
        records = []
        for path in self.projects.glob("*/project.json"):
            records.append(ProjectRecord.model_validate_json(path.read_text(encoding="utf-8")))
        return sorted(records, key=lambda item: item.created_at, reverse=True)

    def load_config(self, project_id: str) -> ProjectConfig:
        record = self.get(project_id)
        return ProjectConfig.model_validate(yaml.safe_load(record.config_path.read_text(encoding="utf-8")))

    def _available_id(self, name: str) -> str:
        stem = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "web-palace"
        candidate = stem
        index = 2
        while (self.projects / candidate).exists():
            candidate = f"{stem}-{index}"
            index += 1
        return candidate

    def _save_record(self, record: ProjectRecord) -> None:
        path = record.config_path.parent / "project.json"
        path.write_text(record.model_dump_json(indent=2), encoding="utf-8")

    @staticmethod
    def _save_config(config: ProjectConfig, path: Path) -> None:
        path.write_text(
            yaml.safe_dump(config.model_dump(mode="json"), sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

    @staticmethod
    def _extract(path: Path, suffix: str) -> str:
        if suffix in {".txt", ".md"}:
            content = path.read_text(encoding="utf-8")
            return content[:MAXIMUM_EXTRACTED_CHARACTERS]
        if suffix == ".pdf":
            content = "\n\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
            return content[:MAXIMUM_EXTRACTED_CHARACTERS]
        if suffix == ".docx":
            content = "\n".join(paragraph.text for paragraph in Document(path).paragraphs)
            return content[:MAXIMUM_EXTRACTED_CHARACTERS]
        raise ValueError(f"Unsupported source type: {suffix}")
