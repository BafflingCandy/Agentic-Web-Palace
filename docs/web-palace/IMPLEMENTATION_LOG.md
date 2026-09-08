# Implementation Log

## Scope

Restored the exact existing Web Palace application as the product shell and integrated the Architect → Builder → Reviewer creator as a separate route.

## Implemented

- Added FastAPI endpoints for provider readiness, project creation, source uploads, run start/status/events, approval resume, accepted Palaces, and ZIP download.
- Added local project storage with safe IDs, upload limits, filename normalization, and extraction for TXT, Markdown, PDF, and DOCX.
- Added a minimal responsive intake UI for the brief, learner, objective, sources, provider/model profiles, image intent, iteration/call/cost limits, and an approval-or-automatic execution choice.
- Added live workflow state over server-sent events.
- Replaced the permanent side workflow with a minimal full-screen creation overlay that reports the current stage only while work is active and respects reduced motion.
- Added approve, revise, and reject controls at the durable LangGraph checkpoint.
- Added an approval-aware image-generation node, safe PNG paths, a maximum image count, and projected-cost checks.
- Added an accepted-Palace registry so Reviewer acceptance creates an idempotent node with a downloadable workspace.
- Retained the CLI and YAML flow for reproducible or automated use.
- Preserved the original Web Palace introduction, brain canvas, registry utilities, and visual language.
- Preserved the original shader “Welcome to Web Palace” introduction, particle brain canvas, website search, alphabetical index, internal/external destinations, Add Node drawer, removal flow, registry validation, and deterministic dot placement.
- Added only an “Open creator” integration entry to the original Add Node drawer.
- Added `/create` for agentic website creation and `/generated` for accepted generated-site handoff.
- Connected Reviewer acceptance to the original canonical registry writer so an accepted generated website receives exactly one stable brain dot.
- Isolated Next.js development output in `.next-dev` and production output in `.next` so verification builds cannot invalidate chunks used by the running local studio.
- Hardened verification commands: exact allow-list matching remains, shell metacharacters and arbitrary executables are rejected, and permitted package scripts run as argument arrays with `shell=False`.
- Removed the creator's API-key explainer, operating-contract copy, technical command editor, and duplicate accepted-work list. Accepted websites are represented in the canonical visual brain.
- Kept safe verification commands internal to the creator and exposed two plain-language modes: pause for approval, or continue automatically within the existing workspace and command limits.
- Removed every example Palace, its route code, subject data, generated imagery, source PDFs, and subject-specific documentation. The distributable repository now starts with an empty brain.

## Deliberate boundaries

- Provider keys are read only by the backend environment and are never persisted or returned to the frontend.
- Image generation currently uses OpenAI only; chat roles remain selectable across OpenAI, Anthropic, and DeepSeek.
- The download is a workspace ZIP. Hosting and a live preview server are not implied.
- Tests use fake specialists and a fake image generator, so verification incurs no model or image API charges.

## Deferred

- Per-run disposable Git worktrees or containers.
- Patch-level approval and rollback.
- Reviewer-controlled browser, accessibility, and screenshot evidence.
- Cancellation, retries, rate-limit backoff, authentication, and multi-user storage.
- Comparative provider evaluations and current-price discovery.
