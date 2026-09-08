import { assignTraceNodes } from "./webPalacePlacement";
import {
  validateWebPalaceRegistry,
  type WebPalaceEntry,
  type WebPalaceSeed
} from "./webPalaceRegistry";

export type WebPalaceRegistrationMatch = "created" | "id" | "destination";

export type WebPalaceRegistrationResult = {
  action: WebPalaceRegistrationMatch;
  entry: WebPalaceEntry;
  registry: WebPalaceEntry[];
};

export class WebPalaceRegistrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "IDENTITY_CONFLICT"
      | "INTERNAL_ROUTE_MISSING"
      | "REGISTRY_CHANGED"
      | "REGISTRY_IO"
  ) {
    super(message);
    this.name = "WebPalaceRegistrationError";
  }
}

function destinationKey(entry: WebPalaceSeed) {
  return `${entry.destination.type}:${entry.destination.href}`;
}

/**
 * Creates an idempotent registry update and persists every resolved node in the
 * returned data. Stable IDs take precedence; destination matching is a fallback
 * for callers that rediscover an existing site without knowing its registry ID.
 */
export function prepareWebPalaceRegistration(
  currentValue: unknown,
  candidateValue: unknown,
  nodeCount: number,
  internalRouteExists: (href: string) => boolean
): WebPalaceRegistrationResult {
  const current = validateWebPalaceRegistry(currentValue, nodeCount);
  const [candidate] = validateWebPalaceRegistry([candidateValue], nodeCount);
  const idIndex = current.findIndex((entry) => entry.id === candidate.id);
  const candidateDestination = destinationKey(candidate);
  const destinationIndex = current.findIndex(
    (entry) => destinationKey(entry) === candidateDestination
  );

  if (idIndex >= 0 && destinationIndex >= 0 && idIndex !== destinationIndex) {
    throw new WebPalaceRegistrationError(
      `The ID "${candidate.id}" and destination "${candidate.destination.href}" belong to different registry entries.`,
      "IDENTITY_CONFLICT"
    );
  }

  const matchedIndex = idIndex >= 0 ? idIndex : destinationIndex;
  const action: WebPalaceRegistrationMatch =
    idIndex >= 0 ? "id" : destinationIndex >= 0 ? "destination" : "created";
  const next = [...current];

  if (matchedIndex >= 0) {
    const existing = current[matchedIndex];
    next[matchedIndex] = {
      ...candidate,
      id: existing.id,
      traceNode: candidate.traceNode ?? existing.traceNode
    };
  } else {
    next.push(candidate);
  }

  const validated = validateWebPalaceRegistry(next, nodeCount);

  validated.forEach((entry) => {
    if (
      entry.status === "live" &&
      entry.destination.type === "internal" &&
      !internalRouteExists(entry.destination.href)
    ) {
      throw new WebPalaceRegistrationError(
        `Live internal destination "${entry.destination.href}" does not resolve to an application route.`,
        "INTERNAL_ROUTE_MISSING"
      );
    }
  });

  const registry = assignTraceNodes(validated);
  const entry = registry[matchedIndex >= 0 ? matchedIndex : registry.length - 1];

  return { action, entry, registry };
}
