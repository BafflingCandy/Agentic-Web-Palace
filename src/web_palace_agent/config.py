from __future__ import annotations

from pathlib import Path

import yaml

from .schemas import ProjectConfig


def load_project_config(path: Path) -> ProjectConfig:
    config_path = path.resolve()
    data = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    base = config_path.parent
    repository = Path(data["repository"])
    if not repository.is_absolute():
        # Project files live under projects/, so relative workspaces resolve from project root.
        repository = (base.parent / repository).resolve()
    data["repository"] = repository
    data["source_paths"] = [
        source if Path(source).is_absolute() else (base.parent / source).resolve()
        for source in data.get("source_paths", [])
    ]
    return ProjectConfig.model_validate(data)

