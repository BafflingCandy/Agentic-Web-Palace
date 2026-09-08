import { describe, expect, it } from "vitest";
import { brainTraceNodes } from "../data/brainTrace";
import { webPalaceRegistry, webPalaces } from "../data/webPalaces";
import {
  assignTraceNodes,
  traceNodeCandidates,
  WebPalaceCapacityError
} from "./webPalacePlacement";
import {
  validateWebPalaceRegistry,
  WebPalaceRegistryError,
  type WebPalaceSeed
} from "./webPalaceRegistry";

function makeRawEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "example-palace",
    title: "Example Palace",
    subject: "Example Subject",
    destination: { type: "internal", href: "/palaces/example" },
    status: "live",
    cluster: "Examples",
    summary: "A sufficiently descriptive example website for registry validation.",
    tags: ["Example", "reference", "example"],
    createdAt: "2026-07-24",
    ...overrides
  };
}

function makeSeed(index: number, traceNode?: number): WebPalaceSeed {
  return {
    id: `capacity-${index}`,
    title: `Capacity ${index}`,
    subject: "Capacity Test",
    destination: { type: "internal", href: `/capacity/${index}` },
    status: "live",
    cluster: "Tests",
    summary: "A capacity-test registry entry used to verify node exhaustion.",
    tags: ["capacity"],
    createdAt: "2026-07-24",
    ...(traceNode === undefined ? {} : { traceNode })
  };
}

describe("Web Palace registry foundation", () => {
  it("starts with an empty canonical registry", () => {
    expect(webPalaceRegistry).toEqual([]);
    expect(webPalaces).toEqual([]);
  });

  it("normalizes tags and internal destination trailing slashes", () => {
    const [entry] = validateWebPalaceRegistry(
      [makeRawEntry({ destination: { type: "internal", href: "/palaces/example///" } })],
      brainTraceNodes.length
    );

    expect(entry.tags).toEqual(["example", "reference"]);
    expect(entry.destination.href).toBe("/palaces/example");
  });

  it("accepts only absolute http or https external destinations", () => {
    const [entry] = validateWebPalaceRegistry(
      [makeRawEntry({ destination: { type: "external", href: "https://example.com/guide" } })],
      brainTraceNodes.length
    );

    expect(entry.destination).toEqual({
      type: "external",
      href: "https://example.com/guide"
    });

    expect(() =>
      validateWebPalaceRegistry(
        [makeRawEntry({ destination: { type: "external", href: "javascript:alert(1)" } })],
        brainTraceNodes.length
      )
    ).toThrow(WebPalaceRegistryError);
  });

  it("rejects duplicate ids and duplicate destinations", () => {
    expect(() =>
      validateWebPalaceRegistry(
        [
          makeRawEntry(),
          makeRawEntry({
            id: "example-palace",
            destination: { type: "internal", href: "/palaces/another" }
          })
        ],
        brainTraceNodes.length
      )
    ).toThrow(/duplicates entries\[0\]\.id/);

    expect(() =>
      validateWebPalaceRegistry(
        [
          makeRawEntry(),
          makeRawEntry({
            id: "another-palace",
            destination: { type: "internal", href: "/palaces/example/" }
          })
        ],
        brainTraceNodes.length
      )
    ).toThrow(/destination duplicates/);
  });

  it("preserves case-sensitive destination paths while canonicalizing external hosts", () => {
    const entries = validateWebPalaceRegistry(
      [
        makeRawEntry({
          destination: { type: "external", href: "https://EXAMPLE.com/Guide" }
        }),
        makeRawEntry({
          id: "lowercase-guide",
          destination: { type: "external", href: "https://example.com/guide" }
        }),
        makeRawEntry({
          id: "internal-uppercase-guide",
          destination: { type: "internal", href: "/palaces/Guide" }
        }),
        makeRawEntry({
          id: "internal-lowercase-guide",
          destination: { type: "internal", href: "/palaces/guide" }
        })
      ],
      brainTraceNodes.length
    );

    expect(entries.map((entry) => entry.destination.href)).toEqual([
      "https://example.com/Guide",
      "https://example.com/guide",
      "/palaces/Guide",
      "/palaces/guide"
    ]);

    expect(() =>
      validateWebPalaceRegistry(
        [
          makeRawEntry({
            destination: { type: "external", href: "HTTPS://EXAMPLE.COM/guide" }
          }),
          makeRawEntry({
            id: "canonical-host-duplicate",
            destination: { type: "external", href: "https://example.com/guide" }
          })
        ],
        brainTraceNodes.length
      )
    ).toThrow(/destination duplicates/);
  });

  it("rejects invalid dates, ids, fields, and trace-node pins", () => {
    expect(() =>
      validateWebPalaceRegistry(
        [
          makeRawEntry({
            id: "Invalid ID",
            title: "",
            createdAt: "2026-02-30",
            traceNode: brainTraceNodes.length
          })
        ],
        brainTraceNodes.length
      )
    ).toThrow(WebPalaceRegistryError);
  });

  it("rejects two entries pinned to the same node", () => {
    expect(() =>
      validateWebPalaceRegistry(
        [
          makeRawEntry({ traceNode: 10 }),
          makeRawEntry({
            id: "another-palace",
            destination: { type: "internal", href: "/palaces/another" },
            traceNode: 10
          })
        ],
        brainTraceNodes.length
      )
    ).toThrow(/traceNode duplicates/);
  });

  it("assigns unpinned nodes deterministically and preserves valid pins", () => {
    const entries = [
      makeSeed(0, traceNodeCandidates[0].index),
      makeSeed(1),
      makeSeed(2)
    ];

    const firstAssignment = assignTraceNodes(entries);
    const secondAssignment = assignTraceNodes(entries);

    expect(secondAssignment.map((entry) => entry.traceNode)).toEqual(
      firstAssignment.map((entry) => entry.traceNode)
    );
    expect(firstAssignment[0].traceNode).toBe(traceNodeCandidates[0].index);
    expect(new Set(firstAssignment.map((entry) => entry.traceNode)).size).toBe(entries.length);
  });

  it("fails explicitly when every eligible brain node is already occupied", () => {
    const fullRegistry = traceNodeCandidates.map((candidate, index) =>
      makeSeed(index, candidate.index)
    );
    fullRegistry.push(makeSeed(fullRegistry.length));

    expect(() => assignTraceNodes(fullRegistry)).toThrow(WebPalaceCapacityError);
  });
});
