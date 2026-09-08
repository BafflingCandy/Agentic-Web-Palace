import { describe, expect, it } from "vitest";
import {
  isLocalMutationHost,
  parseAddNodeFormData
} from "./webPalaceAddNode";

function validFormData() {
  const formData = new FormData();
  formData.set("title", "Research Library");
  formData.set("destination", "/palaces/research-library");
  formData.set("subject", "Research");
  formData.set("summary", "A focused collection of research notes and practical references.");
  formData.set("tags", "Research, Notes, reference");
  return formData;
}

describe("minimal Add Node input", () => {
  it("builds normalized registry metadata from the minimal fields", () => {
    const result = parseAddNodeFormData(
      validFormData(),
      new Date("2026-07-24T12:00:00.000Z")
    );

    expect(result).toEqual({
      success: true,
      candidate: {
        id: "research-library",
        title: "Research Library",
        subject: "Research",
        destination: {
          type: "internal",
          href: "/palaces/research-library"
        },
        status: "live",
        cluster: "Research",
        summary: "A focused collection of research notes and practical references.",
        tags: ["research", "notes", "reference"],
        createdAt: "2026-07-24"
      }
    });
  });

  it("supports external URLs and queued advanced options", () => {
    const formData = validFormData();
    formData.set("destination", "https://example.com/Library");
    formData.set("cluster", "Personal Knowledge");
    formData.set("status", "queued");
    const result = parseAddNodeFormData(formData);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.candidate.destination).toEqual({
        type: "external",
        href: "https://example.com/Library"
      });
      expect(result.candidate.cluster).toBe("Personal Knowledge");
      expect(result.candidate.status).toBe("queued");
    }
  });

  it("returns field-level errors for incomplete or unsafe input", () => {
    const formData = validFormData();
    formData.set("title", "!");
    formData.set("destination", "//example.com/unsafe");
    formData.set("summary", "Too short");
    formData.set("tags", "");
    const result = parseAddNodeFormData(formData);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.errors).toMatchObject({
        title: expect.any(String),
        destination: expect.any(String),
        summary: expect.any(String),
        tags: expect.any(String)
      });
    }
  });

  it("permits mutations only from loopback host headers", () => {
    expect(isLocalMutationHost("localhost:3021")).toBe(true);
    expect(isLocalMutationHost("127.0.0.1:3021")).toBe(true);
    expect(isLocalMutationHost("[::1]:3021")).toBe(true);
    expect(isLocalMutationHost("192.168.1.40:3021")).toBe(false);
    expect(isLocalMutationHost("web-palace.example")).toBe(false);
    expect(isLocalMutationHost(null)).toBe(false);
  });
});
