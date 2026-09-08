# Project Context

## Purpose

Convert the original human-orchestrated Web Palace Architect, Builder, and Reviewer skills into a bounded, observable agentic workflow.

## Public framing

The repository contains two related surfaces:

- `src/web_palace_agent/`: the real Python LangChain/LangGraph workflow.
- `web/`: the Web Palace introduction and brain canvas, plus the agentic creator route.

The public explanation should accurately distinguish reusable skills from executable orchestration. It must not claim autonomous production readiness before real repository isolation, approval resumption, browser verification, and evaluations are implemented.

## Current decisions

- LangGraph owns explicit transitions, feedback loops, checkpointing, and termination.
- LangChain model integrations return Pydantic structured outputs.
- Each specialist has an independent provider/model profile; the example uses OpenAI but the application core is provider-neutral.
- The creator defaults to a durable LangGraph approval pause before filesystem changes or commands, with an explicit automatic option that retains workspace, command, call, cost, and iteration limits.
- Provider-reported tokens, configured price estimates, model-call limits, and cost limits are part of workflow state.
- The project ships no demo provider or simulated workflow.
- Tests may use local fakes to validate deterministic behavior without API calls.
- The introduction uses a code-native workflow brain because the relationship graph is the core teaching visual.
- Shell commands use exact allow-list matching.
- Output paths are constrained to the configured repository.
- Provider secrets stay in the backend environment; the frontend sees readiness booleans only.
- Optional OpenAI image generation is a bounded graph stage between approval and build application.
- Reviewer-accepted projects are recorded as nodes in a local Palace registry.

## Current routes

- `/`: the original “Welcome to Web Palace” sequence, animated brain canvas, website search/index, and local external/internal node management.
- `/create`: project intake, source upload, provider/model controls, and a choice between approval and bounded automatic execution.
- `/generated?project=<id>`: accepted generated-website record and ZIP handoff.
- The repository starts with an empty Palace registry. Generated or manually added websites become brain nodes later.
- `/api/*`: local project, run, SSE, resume, provider-readiness, registry, and ZIP endpoints.

## Verification targets

- Python unit tests pass.
- Python CLI help loads.
- Next.js production build passes.
- The landing page renders without console errors at desktop and mobile widths.
- Every form control has a programmatic label and keyboard-native behavior.
- Desktop and mobile layouts remain readable without horizontal overflow.
- No provider secret is returned by `/api/providers`.
- Offline integration tests cover project intake, approval/resume, acceptance, registry, and ZIP output.
- Original Web Palace tests cover canonical registry validation, duplicate prevention, search, removal, command parsing, and deterministic trace-node placement.

## Deferred before valuable repositories

- disposable Git worktree or sandbox per run;
- patch/diff approval;
- isolated browser/accessibility/screenshot tools available to the Reviewer;
- command evidence supplied to Reviewer;
- retry/cancellation/rate-limit policy;
- seeded model evaluations;
- n8n triggers and notifications.
