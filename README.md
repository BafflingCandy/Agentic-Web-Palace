# Web Palace Agent

An executable, bounded **Architect → Builder → Reviewer** LangChain/LangGraph workflow derived from the Web Palace Codex skills.

This project deliberately separates two responsibilities:

- The language-model agents make semantic judgments and return typed results.
- LangGraph owns routing, feedback loops, checkpoints, iteration limits, and stopping conditions.
- Deterministic Python owns filesystem and command boundaries.

## Architecture

```text
Project YAML
    |
    v
LangGraph -------> SQLite checkpoints + RunStore evidence
    |
    +--> Architect --> required specification artifacts
    |
    +--> Builder ----> bounded file changes + allow-listed commands
    |
    +--> Reviewer ---> typed decision + findings
            |
            +-- ACCEPT --------------------> stop
            +-- CHANGES_REQUIRED ----------> Builder
            +-- REJECT_AND_REARCHITECT ----> Architect
            +-- REVIEW_BLOCKED ------------> Human
```

## Why this is agentic

The workflow does more than call three prompts. It observes persistent workspace state, lets specialists reason about their bounded roles, acts through controlled file and command interfaces, evaluates results, feeds review findings into the next iteration, and stops according to explicit policies.

## Set up

Python 3.11–3.14 is supported by this project configuration.

```powershell
cd C:\Users\pnaga\Documents\ChatGPT\Agentic_app\web-palace-agent
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
```

## Configure a project

Copy `projects/project.example.yaml`, replace the brief and repository values, choose a provider and model independently for each specialist, and keep only the exact commands that Builder may request.

Your normal inputs all belong in that project YAML:

- `subject`, `audience`, and `objective` describe what the Web Palace should teach.
- `repository` is the disposable target workspace.
- `source_paths` lists your notes and source files.
- `models` selects the provider, model, output ceiling, and current token prices for each role.
- `maximum_build_iterations` and `maximum_architecture_revisions` bound feedback loops.
- `maximum_model_calls` and `maximum_estimated_cost_usd` bound API use.
- `require_build_approval` pauses before Builder changes or commands are applied.
- `allowed_commands` is an exact command allowlist.

Keep iteration limits. A Reviewer can repeatedly request changes, so an unbounded feedback edge can run indefinitely. `maximum_build_iterations` counts applied builds. `maximum_architecture_revisions` counts redesigns after the initial architecture. These limits are safety controls, not a statement about how many revisions good work should require.

The example uses OpenAI for all three roles, but this is configuration rather than an application dependency. Install the relevant optional integration to use another provider:

```powershell
python -m pip install -e ".[anthropic]"
python -m pip install -e ".[deepseek]"
```

## Run the agents

Create an API key with the provider selected in the project YAML. Codex does not expose a reusable “Codex API key”; ChatGPT/Codex product access and API billing are separate. Store keys only in environment variables or a secret manager:

```powershell
$env:OPENAI_API_KEY = "your-key"
web-palace-agent run projects\my-project.yaml
```

When approval is enabled, the workflow checkpoints and stops before applying the Builder proposal. Inspect `runs\<run-id>\builder-*.json`, then resume it:

```powershell
web-palace-agent resume projects\my-project.yaml <run-id> approve
web-palace-agent resume projects\my-project.yaml <run-id> revise --feedback "Keep the existing navigation"
web-palace-agent resume projects\my-project.yaml <run-id> reject --feedback "Do not modify this repository"
```

Never commit the key. `.env` is ignored, and `.env.example` contains placeholders only.

The live adapter uses LangChain's common chat-model interface and Pydantic structured outputs. LangGraph—not an LLM—selects the next node. Every run is assigned a LangGraph thread ID and persisted to `checkpoints.sqlite`.

Agents return complete file contents, but the host validates every path and command before presenting the proposal for approval. Approval resumes the same SQLite-checkpointed graph and only then applies changes. Continue using a disposable repository until isolated Git worktrees or sandboxes are added.

## Run Web Palace and its creator

The frontend preserves the complete original Web Palace experience. `/` runs the “Welcome to Web Palace” sequence and interactive website brain. Its Add Node drawer can register an existing internal route or external URL. `/create` creates a new website through the real checkpointed agent workflow.

Start the backend in one terminal:

```powershell
cd C:\Users\pnaga\Documents\ChatGPT\Agentic_app\web-palace-agent
.venv\Scripts\Activate.ps1
$env:OPENAI_API_KEY = "your-key" # or ANTHROPIC_API_KEY / DEEPSEEK_API_KEY
web-palace-api
```

Start the frontend in another terminal:

```powershell
cd web
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000` for the Web Palace brain. Select the plus button and choose **Open creator**, or visit `http://localhost:3000/create`. API keys remain in the backend process; the browser receives only provider readiness. Uploaded `.txt`, `.md`, `.pdf`, and `.docx` files are extracted locally (20 MB per file), stored beneath the ignored `data/` directory, and copied into a project-specific workspace.

The optional image stage currently supports OpenAI image generation. It is independently bounded, cost-estimated, and included in the approval payload before any paid generation. Reviewer-accepted sites are passed to the original canonical Web Palace registry and automatic dot-placement service, then exposed through a generated-site detail and ZIP handoff page. The UI does not yet host each generated framework as a live deployment.

## Read the code in this order

1. `schemas.py` — the shared language and validation rules.
2. `providers.py` — provider-neutral LangChain model creation and prompt composition.
3. `orchestrator.py` — LangGraph nodes, edges, feedback loops, and stopping conditions.
4. `routing.py` — the small standalone decision mapping retained for focused tests.
5. `workspace.py` — the narrow action boundary.
6. `storage.py` — persistent state and observable run evidence.
7. `project_store.py` and `registry.py` — local intake and accepted-Palace persistence.
8. `api.py` — HTTP, SSE, approval, and download boundaries.
9. `cli.py` — the terminal entry point.
10. `web/src/components/WebPalaceBrain.tsx` — the original animated website brain.
11. `web/src/data/webPalaceRegistry.json` — the canonical visual-node registry.
12. `web/src/components/agent/ProjectStudio.tsx` — the separate browser intake and live agent workflow.

## Safety properties already implemented

- Repository-relative artifact paths cannot contain `..` or be absolute.
- Resolved output paths must remain under the configured workspace.
- Shell commands must exactly match a project allow-list.
- Accepted reviews cannot contain open blocker/high findings.
- Review decisions must agree with their declared next agent.
- Build and architecture cycles have hard limits.
- A finding repeated across three reviews escalates to a human.
- Every stage and output is persisted in a unique run folder.
- LangGraph checkpoints every node under the run's durable thread ID.
- Builder writes and commands can require resumable human approval.
- Provider-reported token usage and configured price estimates are accumulated per role.
- Model-call and estimated-cost limits stop the graph before another specialist call.
- API keys never enter browser state or project files.
- Image requests are path-checked, count-bounded, approval-aware, and budget-checked before generation.
- Uploaded filenames, project IDs, and ZIP contents are constrained to local project storage.

## Next engineering milestones

1. Use a disposable Git worktree or container per run.
2. Add patch-based changes instead of whole-file replacement.
3. Add sandboxed shell, browser, accessibility, and screenshot evidence.
5. Seed an evaluation suite with known defects.
6. Compare models per role using acceptance accuracy, defect recall, cost, and latency.
7. Put n8n outside this service for triggers and notifications while keeping LangGraph as workflow authority.
