from __future__ import annotations

import subprocess
import re
from pathlib import Path

from .schemas import DocumentArtifact, FileChange


class Workspace:
    """Narrow host-filesystem boundary controlled by the application."""

    def __init__(
        self,
        root: Path,
        allowed_commands: list[str],
        command_timeout_seconds: int = 120,
        maximum_command_output_characters: int = 4000,
    ) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.allowed_commands = set(allowed_commands)
        self.command_timeout_seconds = command_timeout_seconds
        self.maximum_command_output_characters = maximum_command_output_characters

    def validate_artifacts(self, artifacts: list[DocumentArtifact | FileChange]) -> list[str]:
        validated: list[str] = []
        for artifact in artifacts:
            destination = (self.root / artifact.relative_path).resolve()
            if self.root != destination and self.root not in destination.parents:
                raise ValueError(f"Path escapes workspace: {artifact.relative_path}")
            validated.append(artifact.relative_path)
        return validated

    def validate_commands(self, commands: list[str]) -> list[str]:
        for command in commands:
            if command not in self.allowed_commands:
                raise ValueError(f"Command was not allow-listed: {command}")
            self._safe_command_arguments(command)
        return commands

    @staticmethod
    def _safe_command_arguments(command: str) -> list[str]:
        """Accept only simple package-script invocations, never shell syntax."""
        if not re.fullmatch(r"[A-Za-z0-9_.:/@=-]+(?: [A-Za-z0-9_.:/@=-]+)*", command):
            raise ValueError(f"Command contains forbidden shell syntax: {command}")
        arguments = command.split(" ")
        executable = arguments[0].lower()
        package_managers = {"npm", "npm.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd", "bun", "bun.exe"}
        if executable not in package_managers:
            raise ValueError(f"Executable is not permitted: {arguments[0]}")
        if len(arguments) < 2 or (
            arguments[1] != "test" and not (arguments[1] == "run" and len(arguments) >= 3)
        ):
            raise ValueError("Only package-manager test and run-script commands are permitted")
        return arguments

    def write_binary(self, relative_path: str, content: bytes) -> str:
        destination = (self.root / relative_path).resolve()
        if self.root != destination and self.root not in destination.parents:
            raise ValueError(f"Path escapes workspace: {relative_path}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        return relative_path

    def write_artifacts(self, artifacts: list[DocumentArtifact | FileChange]) -> list[str]:
        self.validate_artifacts(artifacts)
        written: list[str] = []
        for artifact in artifacts:
            destination = (self.root / artifact.relative_path).resolve()
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(artifact.content, encoding="utf-8")
            written.append(artifact.relative_path)
        return written

    def snapshot(self, maximum_characters: int = 40_000) -> str:
        parts: list[str] = []
        used = 0
        for path in sorted(self.root.rglob("*")):
            if not path.is_file() or any(part.startswith(".") for part in path.relative_to(self.root).parts):
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            block = f"\n--- {path.relative_to(self.root)} ---\n{content}"
            if used + len(block) > maximum_characters:
                break
            parts.append(block)
            used += len(block)
        return "".join(parts) or "(workspace is empty)"

    def run_approved(self, commands: list[str]) -> list[dict[str, object]]:
        self.validate_commands(commands)
        results: list[dict[str, object]] = []
        for command in commands:
            arguments = self._safe_command_arguments(command)
            completed = subprocess.run(
                arguments,
                cwd=self.root,
                shell=False,
                capture_output=True,
                text=True,
                timeout=self.command_timeout_seconds,
            )
            results.append(
                {
                    "command": command,
                    "exit_code": completed.returncode,
                    "stdout": completed.stdout[-self.maximum_command_output_characters :],
                    "stderr": completed.stderr[-self.maximum_command_output_characters :],
                }
            )
        return results
