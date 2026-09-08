# Architecture and Code Walkthrough

## 1. The central idea

The system combines probabilistic judgment with deterministic control:

```text
LLM specialist: "This implementation needs changes."
                         |
                         v
Typed ReviewResult validated by Pydantic
                         |
                         v
LangGraph conditional edge: CHANGES_REQUIRED -> builder
```

An LLM decides *what the work means*. LangGraph and ordinary Python decide *what the workflow is allowed to do next*.

This prevents several common failures:

- An agent cannot invent an unknown destination stage.
- An accepted result cannot hide an open blocker or high finding.
- A file path cannot escape the configured repository.
- A command cannot run unless the project explicitly permits the exact command.
- A loop cannot continue forever.

## 2. Entry point

`cli.py` parses terminal runs. `api.py` exposes the same orchestrator to the local studio and adds intake, source extraction, live events, approval resume, registry, and download boundaries:

```text
web-palace-agent run <project.yaml>

browser -> FastAPI -> ProjectStore -> Orchestrator -> LangGraph
                         |                |
                         v                v
                    source text     SQLite + run evidence

The browser product has two responsibilities:

```text
/                         original Web Palace canvas and canonical website registry
├── Add Node              register an existing internal route or external URL
└── Open creator ───────> /create
                              |
                              v
                         agent workflow
                              |
                       Reviewer acceptance
                              |
                              v
                 canonical trace-node registration
                              |
                              v
                  /generated?project=<id>
```

The visual brain dots are website registry entries; they are not LangGraph nodes. LangGraph nodes coordinate the creation workflow behind `/create`. The two graphs meet only after Reviewer acceptance, when the canonical Web Palace placement service assigns the generated website a stable visual trace node.
```

It loads `ProjectConfig`, creates the provider-neutral LangChain adapter and `Orchestrator`, and prints the final `WorkflowState`.

`LangChainAgentProvider` obtains specialist judgments through whichever provider/model each role selects. LangGraph retains routing authority. Unit tests inject fake specialists and therefore make no paid API calls.

## 3. Shared language

`schemas.py` defines the objects exchanged across boundaries.

### ProjectConfig

Declares the goal, repository, role-specific provider/model profiles, iteration limits, and exact commands the workflow may run.

### ArchitectureResult

Contains a readiness status, specification version, unresolved decisions, and the five required design artifacts.

### BuildResult

Contains bounded file changes, requested allow-listed commands, addressed finding IDs, and a completion status.

### ReviewResult

Contains findings and one of five decisions. Its validator enforces the legal destination:

| Decision | Required next agent |
| --- | --- |
| `ACCEPT` | `NONE` |
| `ACCEPT_WITH_LOW_RISK_NOTES` | `NONE` |
| `CHANGES_REQUIRED` | `BUILDER` |
| `REJECT_AND_REARCHITECT` | `ARCHITECT` |
| `REVIEW_BLOCKED` | `HUMAN` |

### WorkflowState

Records where the run is, how many times each stage ran, current outputs, approval feedback, provider usage, estimated cost, open findings, repeated findings, and terminal status.

## 4. The LangGraph workflow

`build_workflow_graph()` declares the workflow engine:

```text
START -> architect -> builder -> build approval -> generate assets -> apply build -> reviewer
                      ^                                      |
                      |---------------- fixes ----------------|

reviewer -> architect       when the learning architecture is rejected
reviewer -> accepted        when acceptance criteria pass
reviewer -> human_input     when evidence or a decision is blocked
reviewer -> iteration_limit when a configured boundary is exhausted
```

Each node receives the current typed `WorkflowState` and returns only its updates. Conditional edges inspect the validated stage and counters to select the next node.

### Architect gate

1. Check the architecture-revision limit.
2. Ask the provider for `ArchitectureResult`.
3. Persist the raw structured result.
4. Stop for unresolved human decisions when necessary.
5. Verify all five mandatory documents were returned.
6. Write only validated relative paths.
7. Route to Builder.

### Builder gate

1. Check the build-iteration limit.
2. Ask the provider for `BuildResult`.
3. Persist the result.
4. Validate every proposed path and command without applying anything.
5. Pause at a durable interrupt when approval is required.
6. Validate image paths/counts and optionally generate approved assets within the configured budget.
7. After approval, apply changes and run exact allow-listed commands with bounded time and output.
8. Route to Reviewer even when a command fails, so the independent reviewer can judge the evidence.

### Reviewer gate

1. Ask the provider for `ReviewResult`.
2. Persist the review independently of the build report.
3. Extract open findings.
4. Count repeated finding IDs.
5. Escalate when one stays open for three reviews.
6. Use the deterministic routing table.

## 5. Persistence and observability

Every run receives an immutable ID and directory:

```text
runs/run-.../
├── state.json
├── events.jsonl
├── checkpoints.sqlite
├── architect-0.json
├── builder-1.json
├── commands-1.json
├── reviewer-1.json
├── builder-2.json
├── commands-2.json
├── reviewer-2.json
└── final-report.md
```

`state.json` answers “where did the workflow finish?” `events.jsonl` answers “what happened in order?” `checkpoints.sqlite` preserves LangGraph state after graph steps. The stage output files answer “what did each specialist claim?” The workspace answers “what was actually changed?”

When the graph reaches `build_approval`, LangGraph persists the proposed file list and commands before returning control to the CLI. `resume` reopens the same checkpoint database and supplies an `approve`, `revise`, or `reject` decision. The Builder is not called again on approval, and no proposed change is written before that decision.

## 6. What LangChain does

`LangChainAgentProvider` builds a chat model for each role from `ModelSettings`. Each invocation receives:

- focused role instructions from `prompts/`;
- the project brief;
- the current workflow counters and findings;
- a bounded textual workspace snapshot;
- a Pydantic structured-output schema.

LangChain normalizes provider initialization, messages, asynchronous invocation, and structured output. It does not own the Architect–Builder–Reviewer loop; LangGraph does.

Structured calls use `include_raw=True` so provider-reported input, cached-input, output, and total tokens remain available beside the validated Pydantic result. Prices are supplied in project configuration because providers can change them independently. The workflow accumulates estimates and stops before another model call once its call or cost boundary is reached. A single in-flight call can still take the estimate past the configured dollar boundary, so per-role output limits and provider account controls remain important.

The provider configuration is intentionally outside graph logic. OpenAI, Anthropic, and DeepSeek can be selected per role after installing their integration packages and setting their API keys. Models still differ in structured-output quality and supported features, so portability requires evaluation rather than assuming identical behavior.

## 7. What LangGraph does

LangGraph represents the specialists and terminal outcomes as nodes. Fixed and conditional edges represent the collaboration contract. A SQLite checkpointer associates every snapshot with the run ID as its `thread_id`, enabling inspection and later resume work without encoding control flow in a `while` loop.

## 8. What is implemented versus deferred

Implemented now:

- executable three-specialist LangGraph;
- provider-neutral LangChain adapter;
- independent model configuration per specialist;
- structured outputs;
- artifact validation;
- workspace containment;
- exact command allow-list;
- persistent run state and events;
- remediation routing;
- rearchitecture routing;
- human escalation;
- resumable approval before Builder writes or commands;
- bounded iterations;
- bounded command duration and captured output;
- provider token accounting and configured cost estimates;
- model-call and workflow-cost stopping limits;
- SQLite graph checkpoints;
- local FastAPI project intake and SSE run observation;
- PDF/DOCX/Markdown/text source extraction;
- browser-safe provider readiness without secret disclosure;
- optional approval-aware OpenAI image generation;
- accepted-Palace registry and workspace ZIP download;
- offline schema, routing, feedback-loop, and persistence tests.

Required before using it on valuable repositories:

- disposable Git worktree or sandbox per run;
- patch/diff review rather than only whole-file replacement;
- browser, accessibility, and screenshot verification tools;
- cancellation, API retry, and rate-limit policy;
- secret-manager integration;
- model evaluations on seeded Web Palace tasks.

## 9. Recommended learning exercises

1. Change `CHANGES_REQUIRED` to route incorrectly and watch `test_routing.py` fail.
2. Try constructing an accepted review with an open high finding and observe Pydantic reject it.
3. Draw the edges declared in `build_workflow_graph()` and compare them with the graph test.
4. Add one safe allow-listed command to a disposable project and inspect `commands-*.json`.
5. Write a test provider that returns `REJECT_AND_REARCHITECT` once.
6. Change only one role's provider in project YAML and run it against a small disposable project.
