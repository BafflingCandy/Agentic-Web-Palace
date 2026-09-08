import time

from fastapi.testclient import TestClient

from web_palace_agent.api import create_app
from web_palace_agent.providers import AgentProvider
from web_palace_agent.schemas import ArchitectureResult, BuildResult, DocumentArtifact, FileChange, ReviewDecision, ReviewResult


class AcceptingProvider(AgentProvider):
    async def architect(self, config, state, snapshot):
        names = ["SOURCE_LEDGER", "KNOWLEDGE_MODEL", "EXPERIENCE_SPEC", "CONTENT_COVERAGE", "ASSET_PLAN"]
        return ArchitectureResult(
            status="READY_FOR_BUILD", specification_version="1",
            artifacts=[DocumentArtifact(relative_path=f"docs/web-palace/{name}.md", content=f"# {name}") for name in names],
            summary="Ready",
        )

    async def builder(self, config, state, snapshot):
        return BuildResult(
            status="READY_FOR_REVIEW",
            changes=[FileChange(relative_path="index.html", content="<h1>Verified Palace</h1>")],
            implementation_summary="Proposal ready",
        )

    async def reviewer(self, config, state, snapshot):
        return ReviewResult(decision=ReviewDecision.ACCEPT, next_agent="NONE", summary="Verified")


def project_payload():
    model = {
        "provider": "openai",
        "model": "test-model",
        "max_tokens": 1000,
        "input_cost_per_million": None,
        "cached_input_cost_per_million": None,
        "output_cost_per_million": None,
    }
    return {
        "project_name": "Network Palace",
        "subject": "Networking",
        "audience": "A beginner who understands computers",
        "objective": "Explain how computers exchange information",
        "requirements": "Build a sequential, accessible teaching experience.",
        "models": {"architect": model, "builder": model, "reviewer": model},
        "image_generation": {"enabled": False},
        "maximum_build_iterations": 2,
        "maximum_architecture_revisions": 1,
        "maximum_model_calls": 8,
        "require_build_approval": True,
        "allowed_commands": ["npm.cmd run build"],
    }


def test_project_intake_and_text_source_upload(tmp_path):
    application = create_app(tmp_path / "data", tmp_path / "runs")
    client = TestClient(application)

    created = client.post("/api/projects", json=project_payload())
    assert created.status_code == 201
    project_id = created.json()["id"]

    uploaded = client.post(
        f"/api/projects/{project_id}/sources",
        files={"file": ("notes.md", b"# Source notes\nGrounded content", "text/markdown")},
    )
    assert uploaded.status_code == 201
    assert uploaded.json()["name"] == "notes.md"

    config = application.state.projects.load_config(project_id)
    assert len(config.source_paths) == 1
    assert config.source_paths[0].read_text(encoding="utf-8").startswith("# Source notes")
    assert config.repository == (tmp_path / "data" / "workspaces" / project_id).resolve()


def test_upload_rejects_unsupported_source_type(tmp_path):
    client = TestClient(create_app(tmp_path / "data", tmp_path / "runs"))
    project_id = client.post("/api/projects", json=project_payload()).json()["id"]

    response = client.post(
        f"/api/projects/{project_id}/sources",
        files={"file": ("archive.exe", b"unsafe", "application/octet-stream")},
    )

    assert response.status_code == 422
    assert "Unsupported source type" in response.json()["detail"]


def test_provider_endpoint_reports_readiness_without_exposing_key(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "secret-value-that-must-not-leak")
    client = TestClient(create_app(tmp_path / "data", tmp_path / "runs"))

    response = client.get("/api/providers")
    body = response.json()

    assert response.status_code == 200
    assert next(item for item in body if item["id"] == "openai")["configured"] is True
    assert "secret-value-that-must-not-leak" not in response.text


def test_run_requires_provider_key_before_background_work(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    application = create_app(tmp_path / "data", tmp_path / "runs")
    client = TestClient(application)
    project_id = client.post("/api/projects", json=project_payload()).json()["id"]

    response = client.post(f"/api/projects/{project_id}/runs")

    assert response.status_code == 409
    assert response.json()["detail"] == "Configure backend environment variables: OPENAI_API_KEY"


def test_project_ids_cannot_traverse_storage_root(tmp_path):
    client = TestClient(create_app(tmp_path / "data", tmp_path / "runs"))

    response = client.post(
        "/api/projects/..%2F..%2Foutside/sources",
        files={"file": ("notes.md", b"text", "text/markdown")},
    )

    assert response.status_code == 404


def test_api_run_approval_registration_and_download(tmp_path):
    application = create_app(
        tmp_path / "data", tmp_path / "runs", provider_factory=AcceptingProvider
    )
    with TestClient(application) as client:
        project_id = client.post("/api/projects", json=project_payload()).json()["id"]
        started = client.post(f"/api/projects/{project_id}/runs")
        assert started.status_code == 202
        run_id = started.json()["run_id"]
        paused = wait_for_status(client, run_id, "APPROVAL_REQUIRED")
        assert paused["build_result"]["changes"][0]["relative_path"] == "index.html"

        resumed = client.post(
            f"/api/projects/{project_id}/runs/{run_id}/resume",
            json={"decision": "approve", "feedback": ""},
        )
        assert resumed.status_code == 202
        accepted = wait_for_status(client, run_id, "ACCEPTED")
        assert accepted["status"] == "ACCEPTED"

        palaces = client.get("/api/palaces").json()
        assert [item["id"] for item in palaces] == [project_id]
        download = client.get(f"/api/runs/{run_id}/download")
        assert download.status_code == 200
        assert download.content.startswith(b"PK")


def wait_for_status(client: TestClient, run_id: str, expected: str):
    for _ in range(100):
        response = client.get(f"/api/runs/{run_id}")
        if response.status_code == 200 and response.json().get("status") == expected:
            return response.json()
        time.sleep(0.02)
    raise AssertionError(f"Run {run_id} did not reach {expected}")
