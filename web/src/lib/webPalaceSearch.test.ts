import { describe, expect, it } from "vitest";
import { webPalaces } from "../data/webPalaces";
import { filterWebPalaces, groupWebPalacesAlphabetically } from "./webPalaceSearch";

describe("Web Palace search", () => {
  it("searches titles, subjects, clusters, summaries, and tags", () => {
    expect(filterWebPalaces(webPalaces, "pentest")).toEqual([]);
    expect(filterWebPalaces(webPalaces, "probability")).toEqual([]);
  });

  it("returns an alphabetized registry for an empty query", () => {
    expect(filterWebPalaces(webPalaces, "")).toEqual([]);
  });

  it("groups filtered entries by their initial", () => {
    const groups = groupWebPalacesAlphabetically(filterWebPalaces(webPalaces, ""));

    expect(groups).toEqual([]);
  });
});
