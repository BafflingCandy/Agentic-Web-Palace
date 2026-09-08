import { brainTraceNodes } from "../data/brainTrace";
import type { WebPalaceEntry, WebPalaceSeed } from "./webPalaceRegistry";

export type TraceNodeCandidate = {
  index: number;
  x: number;
  y: number;
};

export type AssignedWebPalace = WebPalaceEntry & {
  x: number;
  y: number;
};

export class WebPalaceCapacityError extends Error {
  constructor() {
    super("The Web Palace brain has no available trace nodes for another website.");
    this.name = "WebPalaceCapacityError";
  }
}

export const traceNodeCandidates: TraceNodeCandidate[] = brainTraceNodes
  .map(([x, y], index) => ({ index, x, y }))
  .filter((node) => node.x > 12 && node.x < 91 && node.y > 13 && node.y < 78);

const titleStopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with"
]);

const titleConcepts: Array<{ concept: string; keywords: string[] }> = [
  {
    concept: "computer-science",
    keywords: [
      "algorithm",
      "code",
      "coding",
      "computer",
      "computing",
      "cybersecurity",
      "developer",
      "development",
      "network",
      "networking",
      "programming",
      "software",
      "web"
    ]
  },
  {
    concept: "cybersecurity",
    keywords: [
      "attack",
      "exploit",
      "hacking",
      "metasploit",
      "nmap",
      "payload",
      "pen",
      "pentest",
      "pentester",
      "penetration",
      "recon",
      "security",
      "vulnerability"
    ]
  },
  {
    concept: "networking",
    keywords: [
      "dns",
      "http",
      "ip",
      "network",
      "networking",
      "packet",
      "port",
      "protocol",
      "router",
      "routing",
      "subnet",
      "tcp",
      "udp"
    ]
  },
  {
    concept: "web-development",
    keywords: [
      "app",
      "css",
      "frontend",
      "html",
      "javascript",
      "next",
      "react",
      "site",
      "typescript",
      "web",
      "website"
    ]
  },
  {
    concept: "data-systems",
    keywords: [
      "analytics",
      "data",
      "database",
      "etl",
      "machine",
      "model",
      "pipeline",
      "science",
      "sql",
      "warehouse"
    ]
  }
];

function hashId(id: string) {
  return [...id].reduce((hash, character) => {
    return (hash * 33 + character.charCodeAt(0)) >>> 0;
  }, 5381);
}

function normalizeTitleToken(token: string) {
  return token
    .replace(/ies$/, "y")
    .replace(/ers$/, "er")
    .replace(/ing$/, "")
    .replace(/s$/, "");
}

function getTitleSignals(title: string) {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizeTitleToken)
    .filter((token) => token.length > 1 && !titleStopWords.has(token));
  const signals = new Set(words);

  titleConcepts.forEach(({ concept, keywords }) => {
    if (keywords.some((keyword) => signals.has(normalizeTitleToken(keyword)))) {
      signals.add(concept);
    }
  });

  return signals;
}

export function getTitleRelevanceScore(title: string, comparisonTitle: string) {
  const titleSignals = getTitleSignals(title);
  const comparisonSignals = getTitleSignals(comparisonTitle);

  if (titleSignals.size === 0 || comparisonSignals.size === 0) {
    return 0;
  }

  const sharedSignalCount = [...titleSignals].filter((signal) => comparisonSignals.has(signal)).length;
  const unionSignalCount = new Set([...titleSignals, ...comparisonSignals]).size;

  return sharedSignalCount / unionSignalCount;
}

function hasEnoughRoom(
  candidate: TraceNodeCandidate,
  assignedPositions: Array<{ x: number; y: number }>,
  minimumDistance: number
) {
  return assignedPositions.every((position) => {
    return Math.hypot(candidate.x - position.x, candidate.y - position.y) >= minimumDistance;
  });
}

function findOpenNodeNear(
  anchor: AssignedWebPalace,
  usedNodes: Set<number>,
  assignedPositions: Array<{ x: number; y: number }>
) {
  return traceNodeCandidates
    .filter((candidate) => !usedNodes.has(candidate.index))
    .map((candidate) => ({
      candidate,
      distance: Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y)
    }))
    .sort((a, b) => a.distance - b.distance)
    .find(({ candidate }) => hasEnoughRoom(candidate, assignedPositions, 4.4))?.candidate;
}

function nearestAssignedDistance(
  candidate: TraceNodeCandidate,
  assignedPositions: Array<{ x: number; y: number }>
) {
  if (assignedPositions.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(
    ...assignedPositions.map((position) => Math.hypot(candidate.x - position.x, candidate.y - position.y))
  );
}

function findDeterministicOpenNode(
  entry: WebPalaceSeed,
  entryIndex: number,
  usedNodes: Set<number>,
  assignedPositions: Array<{ x: number; y: number }>
) {
  if (traceNodeCandidates.length === 0) {
    throw new WebPalaceCapacityError();
  }

  const start = (hashId(entry.id) + entryIndex * 47) % traceNodeCandidates.length;

  for (let offset = 0; offset < traceNodeCandidates.length; offset += 1) {
    const candidate = traceNodeCandidates[(start + offset) % traceNodeCandidates.length];

    if (!usedNodes.has(candidate.index) && hasEnoughRoom(candidate, assignedPositions, 8)) {
      return candidate;
    }
  }

  const fallback = traceNodeCandidates
    .filter((candidate) => !usedNodes.has(candidate.index))
    .map((candidate) => ({
      candidate,
      distance: nearestAssignedDistance(candidate, assignedPositions),
      offset: (candidate.index - start + brainTraceNodes.length) % brainTraceNodes.length
    }))
    .sort((a, b) => b.distance - a.distance || a.offset - b.offset)[0]?.candidate;

  if (!fallback) {
    throw new WebPalaceCapacityError();
  }

  return fallback;
}

function findMostRelevantPlacedPalace(entry: WebPalaceSeed, placedPalaces: AssignedWebPalace[]) {
  const relevanceThreshold = 0.12;
  const closest = placedPalaces
    .map((palace) => ({
      palace,
      score: getTitleRelevanceScore(entry.title, palace.title)
    }))
    .sort((a, b) => b.score - a.score)[0];

  return closest && closest.score >= relevanceThreshold ? closest.palace : null;
}

export function findTraceNodeForWebsite(
  entry: WebPalaceSeed,
  entryIndex: number,
  placedPalaces: AssignedWebPalace[],
  usedNodes: Set<number>,
  assignedPositions: Array<{ x: number; y: number }>
) {
  const relatedPalace = findMostRelevantPlacedPalace(entry, placedPalaces);
  const nearbyNode = relatedPalace ? findOpenNodeNear(relatedPalace, usedNodes, assignedPositions) : null;

  return nearbyNode ?? findDeterministicOpenNode(entry, entryIndex, usedNodes, assignedPositions);
}

export function assignTraceNodes(entries: WebPalaceSeed[]): WebPalaceEntry[] {
  const usedNodes = new Set<number>();
  const assignedPositions: Array<{ x: number; y: number }> = [];
  const placedPalaces: AssignedWebPalace[] = [];

  return entries.map((entry, entryIndex) => {
    if (typeof entry.traceNode === "number") {
      const node = brainTraceNodes[entry.traceNode];

      if (!node || usedNodes.has(entry.traceNode)) {
        throw new WebPalaceCapacityError();
      }

      usedNodes.add(entry.traceNode);
      assignedPositions.push({ x: node[0], y: node[1] });

      const placedEntry: WebPalaceEntry = { ...entry, traceNode: entry.traceNode };
      placedPalaces.push({ ...placedEntry, x: node[0], y: node[1] });
      return placedEntry;
    }

    const selected = findTraceNodeForWebsite(entry, entryIndex, placedPalaces, usedNodes, assignedPositions);
    const placedEntry: WebPalaceEntry = { ...entry, traceNode: selected.index };

    usedNodes.add(selected.index);
    assignedPositions.push({ x: selected.x, y: selected.y });
    placedPalaces.push({ ...placedEntry, x: selected.x, y: selected.y });

    return placedEntry;
  });
}
