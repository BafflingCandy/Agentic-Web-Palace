import type { WebPalaceSeed } from "./webPalaceRegistry";

export type RegistrationCommandResult =
  | { help: true }
  | { help: false; candidate: WebPalaceSeed };

const valueFlags = new Set([
  "id",
  "title",
  "subject",
  "destination",
  "cluster",
  "summary",
  "tags",
  "status",
  "created-at",
  "trace-node"
]);

export class WebPalaceCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebPalaceCommandError";
  }
}

function readRequired(values: Map<string, string>, name: string) {
  const value = values.get(name)?.trim();

  if (!value) {
    throw new WebPalaceCommandError(`Missing required option --${name}.`);
  }

  return value;
}

export function parseRegistrationCommandArgs(
  args: string[],
  today = new Date()
): RegistrationCommandResult {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { help: true };
  }

  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];

    if (!option?.startsWith("--")) {
      throw new WebPalaceCommandError(`Unexpected argument "${option ?? ""}".`);
    }

    const name = option.slice(2);

    if (!valueFlags.has(name)) {
      throw new WebPalaceCommandError(`Unknown option --${name}.`);
    }

    if (values.has(name)) {
      throw new WebPalaceCommandError(`Option --${name} was provided more than once.`);
    }

    if (value === undefined || value.startsWith("--")) {
      throw new WebPalaceCommandError(`Option --${name} requires a value.`);
    }

    values.set(name, value);
  }

  const id = readRequired(values, "id");
  const title = readRequired(values, "title");
  const subject = readRequired(values, "subject");
  const destinationHref = readRequired(values, "destination");
  const summary = readRequired(values, "summary");
  const tags = readRequired(values, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const cluster = values.get("cluster")?.trim() || subject;
  const status = values.get("status")?.trim() || "live";
  const createdAt =
    values.get("created-at")?.trim() || today.toISOString().slice(0, 10);
  const traceNodeValue = values.get("trace-node")?.trim();

  if (status !== "live" && status !== "queued") {
    throw new WebPalaceCommandError("--status must be live or queued.");
  }

  let traceNode: number | undefined;

  if (traceNodeValue !== undefined) {
    traceNode = Number(traceNodeValue);

    if (!Number.isInteger(traceNode)) {
      throw new WebPalaceCommandError("--trace-node must be an integer.");
    }
  }

  return {
    help: false,
    candidate: {
      id,
      title,
      subject,
      destination: destinationHref.startsWith("/")
        ? { type: "internal", href: destinationHref }
        : { type: "external", href: destinationHref },
      status,
      cluster,
      summary,
      tags,
      createdAt,
      ...(traceNode === undefined ? {} : { traceNode })
    }
  };
}
