export type WebPalaceDestination =
  | { type: "internal"; href: string }
  | { type: "external"; href: string };

export type WebPalaceSeed = {
  id: string;
  title: string;
  subject: string;
  destination: WebPalaceDestination;
  status: "live" | "queued";
  cluster: string;
  summary: string;
  tags: string[];
  createdAt: string;
  traceNode?: number;
};

export type WebPalaceEntry = WebPalaceSeed & {
  traceNode: number;
};

export class WebPalaceRegistryError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid Web Palace registry:\n- ${issues.join("\n- ")}`);
    this.name = "WebPalaceRegistryError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: string[]
) {
  const value = record[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${path}.${field} must be a non-empty string`);
    return null;
  }

  return value.trim();
}

function normalizeInternalHref(href: string) {
  if (href === "/") {
    return href;
  }

  return href.replace(/\/+$/, "");
}

function readDestination(value: unknown, path: string, issues: string[]): WebPalaceDestination | null {
  if (!isRecord(value)) {
    issues.push(`${path}.destination must be an object`);
    return null;
  }

  const type = value.type;
  const href = typeof value.href === "string" ? value.href.trim() : "";

  if (type !== "internal" && type !== "external") {
    issues.push(`${path}.destination.type must be "internal" or "external"`);
    return null;
  }

  if (!href) {
    issues.push(`${path}.destination.href must be a non-empty string`);
    return null;
  }

  if (type === "internal") {
    if (!href.startsWith("/") || href.startsWith("//")) {
      issues.push(`${path}.destination.href must start with one "/" for an internal route`);
      return null;
    }

    return { type, href: normalizeInternalHref(href) };
  }

  try {
    const url = new URL(href);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      issues.push(`${path}.destination.href must use http or https`);
      return null;
    }

    return { type, href: url.href };
  } catch {
    issues.push(`${path}.destination.href must be a valid absolute URL`);
    return null;
  }
}

function readTags(value: unknown, path: string, issues: string[]) {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${path}.tags must contain at least one tag`);
    return null;
  }

  const normalizedTags: string[] = [];

  value.forEach((tag, tagIndex) => {
    if (typeof tag !== "string" || tag.trim().length === 0) {
      issues.push(`${path}.tags[${tagIndex}] must be a non-empty string`);
      return;
    }

    const normalizedTag = tag.trim().toLocaleLowerCase();

    if (!normalizedTags.includes(normalizedTag)) {
      normalizedTags.push(normalizedTag);
    }
  });

  return normalizedTags.length > 0 ? normalizedTags : null;
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateWebPalaceRegistry(value: unknown, nodeCount: number): WebPalaceSeed[] {
  const issues: string[] = [];

  if (!Array.isArray(value)) {
    throw new WebPalaceRegistryError(["registry root must be an array"]);
  }

  if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
    throw new WebPalaceRegistryError(["nodeCount must be a positive integer"]);
  }

  const entries: WebPalaceSeed[] = [];

  value.forEach((candidate, index) => {
    const path = `entries[${index}]`;
    const issueCountBeforeEntry = issues.length;

    if (!isRecord(candidate)) {
      issues.push(`${path} must be an object`);
      return;
    }

    const id = readRequiredString(candidate, "id", path, issues);
    const title = readRequiredString(candidate, "title", path, issues);
    const subject = readRequiredString(candidate, "subject", path, issues);
    const cluster = readRequiredString(candidate, "cluster", path, issues);
    const summary = readRequiredString(candidate, "summary", path, issues);
    const createdAt = readRequiredString(candidate, "createdAt", path, issues);
    const destination = readDestination(candidate.destination, path, issues);
    const tags = readTags(candidate.tags, path, issues);
    const status = candidate.status;
    const traceNode = candidate.traceNode;

    if (id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      issues.push(`${path}.id must use lowercase kebab-case`);
    }

    if (status !== "live" && status !== "queued") {
      issues.push(`${path}.status must be "live" or "queued"`);
    }

    if (createdAt && !isIsoDate(createdAt)) {
      issues.push(`${path}.createdAt must be a real date in YYYY-MM-DD format`);
    }

    if (
      traceNode !== undefined &&
      (!Number.isInteger(traceNode) || (traceNode as number) < 0 || (traceNode as number) >= nodeCount)
    ) {
      issues.push(`${path}.traceNode must be an integer between 0 and ${nodeCount - 1}`);
    }

    if (
      issues.length !== issueCountBeforeEntry ||
      !id ||
      !title ||
      !subject ||
      !cluster ||
      !summary ||
      !createdAt ||
      !destination ||
      !tags ||
      (status !== "live" && status !== "queued")
    ) {
      return;
    }

    entries.push({
      id,
      title,
      subject,
      destination,
      status,
      cluster,
      summary,
      tags,
      createdAt,
      ...(typeof traceNode === "number" ? { traceNode } : {})
    });
  });

  const ids = new Map<string, number>();
  const destinations = new Map<string, number>();
  const pinnedNodes = new Map<number, number>();

  entries.forEach((entry, index) => {
    const normalizedId = entry.id.toLocaleLowerCase();
    // External schemes, hosts, and default ports are already canonicalized by
    // URL.href. Preserve path/query/fragment case because those components can
    // identify different resources.
    const normalizedDestination = `${entry.destination.type}:${entry.destination.href}`;
    const priorId = ids.get(normalizedId);
    const priorDestination = destinations.get(normalizedDestination);

    if (priorId !== undefined) {
      issues.push(`entries[${index}].id duplicates entries[${priorId}].id`);
    } else {
      ids.set(normalizedId, index);
    }

    if (priorDestination !== undefined) {
      issues.push(`entries[${index}].destination duplicates entries[${priorDestination}].destination`);
    } else {
      destinations.set(normalizedDestination, index);
    }

    if (entry.traceNode !== undefined) {
      const priorPin = pinnedNodes.get(entry.traceNode);

      if (priorPin !== undefined) {
        issues.push(`entries[${index}].traceNode duplicates entries[${priorPin}].traceNode`);
      } else {
        pinnedNodes.set(entry.traceNode, index);
      }
    }
  });

  if (issues.length > 0) {
    throw new WebPalaceRegistryError(issues);
  }

  return entries;
}
