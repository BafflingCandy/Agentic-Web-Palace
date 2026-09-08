#!/usr/bin/env node

import { join } from "node:path";
import {
  parseRegistrationCommandArgs,
  WebPalaceCommandError
} from "../src/lib/webPalaceRegistrationCommand";
import { registerWebPalaceFile } from "../src/lib/webPalaceRegistration.server";
import { WebPalaceRegistrationError } from "../src/lib/webPalaceRegistration";

const usage = `Register or update one Web Palace brain node.

Usage:
  npm run palace:register -- \\
    --id <stable-kebab-id> \\
    --title <website-title> \\
    --subject <subject> \\
    --destination </internal-route-or-https-url> \\
    --summary <description> \\
    --tags <comma-separated-tags> \\
    [--cluster <category>] \\
    [--status <live|queued>] \\
    [--created-at <YYYY-MM-DD>] \\
    [--trace-node <index>]

The command always uses this repository's canonical registry and application
directory. Repeating the command for the same ID updates one node.`;

async function main() {
  const parsed = parseRegistrationCommandArgs(process.argv.slice(2));

  if (parsed.help) {
    console.log(usage);
    return;
  }

  const result = await registerWebPalaceFile({
    registryPath: join(process.cwd(), "src", "data", "webPalaceRegistry.json"),
    appDirectory: join(process.cwd(), "src", "app"),
    candidate: parsed.candidate
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: result.action,
        id: result.entry.id,
        destination: result.entry.destination.href,
        traceNode: result.entry.traceNode
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const knownError =
    error instanceof WebPalaceCommandError ||
    error instanceof WebPalaceRegistrationError;

  console.error(
    JSON.stringify(
      {
        ok: false,
        error: knownError ? error.message : "Unexpected registration failure."
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
