# Verification Report

## Automated

- Python tests cover project/schema safety, deterministic routing, feedback loops, checkpoints, approval/resume, limits, source intake, provider-secret isolation, API acceptance/registry/download, and image-generation ordering.
- Original Web Palace Vitest suite covers registry validation, registration, removal, search, and trace-node placement.
- The Next.js production build completes with static compilation and type checking.
- The local API health endpoint responds successfully.

## Browser

- Original shell: verified the shader “Welcome to Web Palace” sequence and particle brain canvas with an empty initial registry.
- Add Node: verified existing internal/external URL fields, registry management, and the new creator entry appear in the original drawer.
- Creator: verified `/create` renders in the same monochrome Teko/Poppins visual system and returns to the brain.
- Runtime cache isolation: ran `next build` while `next dev` remained active, then rechecked `/` and `/api/register-generated`; both continued responding without missing-chunk errors.
- Desktop: verified the simplified creator heading, complete project intake, model/image accordions, and creation controls render correctly.
- Creation state: production build verifies the full-screen semantic status overlay and reduced-motion fallback.
- Mobile (390 × 844): verified the navigation simplifies, hero wraps correctly, intake becomes one column, and the page remains readable.
- Accessibility surface: semantic headings, landmark navigation, labelled native inputs, native disclosure controls, a labelled workflow list, and reduced-motion CSS are present.
- No application error was observed during the local render pass.

## Security assertions checked

- `/api/providers` returns only configuration status and environment-variable names, never values.
- Project IDs and artifact/image paths reject traversal.
- Upload types and sizes are bounded.
- Writes occur only after the approval checkpoint when approval is configured.
- Verification commands require exact allow-list matches, reject shell syntax and arbitrary executables, and execute with `shell=False`; injection cases are covered by unit tests.
- Automatic mode removes the human checkpoint but does not remove path validation, call/cost/iteration limits, or the fixed verification-command allow-list.
- ZIP export excludes dependency, build, VCS, and cache directories.

## Known limitations

- This is a trusted single-user local service and does not provide authentication.
- Generated-site runtime isolation and automated visual review remain future work.
- Token and image prices are explicit user inputs; estimates are not provider invoices.
- An approved package script executes the code defined by that generated repository. Command-line injection is blocked, but strong isolation still requires the planned disposable container or worktree boundary.
