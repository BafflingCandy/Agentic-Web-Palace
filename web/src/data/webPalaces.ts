import rawWebPalaceRegistry from "./webPalaceRegistry.json";
import { brainTraceNodes } from "./brainTrace";
import { assignTraceNodes } from "../lib/webPalacePlacement";
import { validateWebPalaceRegistry } from "../lib/webPalaceRegistry";

export type {
  WebPalaceDestination,
  WebPalaceEntry,
  WebPalaceSeed
} from "../lib/webPalaceRegistry";
export {
  findTraceNodeForWebsite,
  getTitleRelevanceScore,
  traceNodeCandidates,
  WebPalaceCapacityError
} from "../lib/webPalacePlacement";

export const webPalaceRegistry = validateWebPalaceRegistry(
  rawWebPalaceRegistry,
  brainTraceNodes.length
);

export const webPalaces = assignTraceNodes(webPalaceRegistry);

export const palaceRegistryStats = [
  { label: "Live palaces", value: webPalaces.filter((palace) => palace.status === "live").length },
  { label: "Clusters", value: new Set(webPalaces.map((palace) => palace.cluster)).size },
  { label: "Registry", value: "Auto-ready" }
];
