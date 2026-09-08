# Web Palace Registration Service

## Purpose

Phase 2 provides the trusted registration layer that both the Web Palace Builder skill and the future Add Node interface can use. UI code should not edit `webPalaceRegistry.json` directly.

## Entry point

Use `registerWebPalaceFile()` from:

```text
src/lib/webPalaceRegistration.server.ts
```

It accepts:

- the canonical registry file path;
- the Next.js `src/app` directory;
- one complete candidate registry record.

## Registration rules

1. Validate the current registry and candidate against the shared schema.
2. Match an existing website by stable `id`.
3. If the ID is unknown, fall back to the normalized destination.
4. Reject a request when its ID and destination point to two different entries.
5. Preserve the existing stable ID and trace-node pin during updates unless a valid explicit pin is supplied.
6. Require every `live` internal destination to resolve to a real application `page` file.
7. Allow a `queued` internal entry before its route exists.
8. Assign unused brain nodes deterministically and persist the resolved node numbers.
9. Re-read the registry before writing to prevent a concurrent request from being silently overwritten.
10. Replace the JSON through a same-directory temporary file and atomic rename.

## Security boundary

- The file-writing service is server-only infrastructure and must never be imported into a client component.
- Internal route resolution rejects traversal segments and will not resolve outside the configured app directory.
- External destinations remain limited to absolute HTTP(S) URLs by the shared validator.
- Phase 3 must add authentication or a strict local-development guard before exposing registration through an HTTP action.
- Do not accept an arbitrary registry path or app directory from browser input.

## Minimal Add Node interface

Phase 3 uses a Next.js server action with two independent gates:

1. the trigger is rendered only in development;
2. the action requires development mode and a loopback Host header (`localhost`, `127.0.0.1`, or `::1`).

The action supplies fixed repository paths to `registerWebPalaceFile()`. Browser input can provide website metadata only; it cannot choose filesystem targets.

The minimal form generates the stable ID from the website name, records the current local date, infers internal versus external destination type, defaults category to subject and places category/status under an Options disclosure.

## Remove from brain

The local Manage section can remove either an external or internal node. Removal always means registry removal only.

- Select an existing node and review its exact destination.
- Choose **Remove from brain**.
- Review the explicit confirmation explaining that website files remain.
- Confirm or cancel.

Before the registry changes, the server writes the original JSON to:

```text
backups/web-palace-registry/
```

That directory is git-ignored and remains available for local recovery. The removal service then uses optimistic concurrency detection and the same atomic replacement strategy as registration. It never receives or deletes a website route, component, asset or arbitrary filesystem path.

## Result

The service returns:

```ts
{
  action: "created" | "id" | "destination";
  entry: WebPalaceEntry;
  registry: WebPalaceEntry[];
}
```

Repeating registration for the same website updates one entry and preserves its node. It never creates a duplicate node.

## Builder command

Phase 4 exposes the shared service as a repository command:

```bash
npm run palace:register -- --help
```

Example:

```bash
npm run palace:register -- \
  --id research-library \
  --title "Research Library" \
  --subject "Research" \
  --destination "/palaces/research-library" \
  --summary "A focused research website with practical notes and references." \
  --tags "research,notes,reference" \
  --cluster "Personal Knowledge" \
  --status live
```

Required options:

- `--id`
- `--title`
- `--subject`
- `--destination`
- `--summary`
- `--tags`

Optional options:

- `--cluster` — defaults to subject
- `--status` — defaults to `live`
- `--created-at` — defaults to the current date
- `--trace-node` — use only to preserve an intentional pin

Run the command from the repository root. Its paths are fixed to `src/data/webPalaceRegistry.json` and `src/app`. Success returns JSON containing `action`, `id`, `destination` and `traceNode`; failures return JSON on stderr and a non-zero exit code.

The command is idempotent because it delegates to `registerWebPalaceFile()`. It never edits the registry through separate command-specific logic.
