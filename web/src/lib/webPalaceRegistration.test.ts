import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brainTraceNodes } from "../data/brainTrace";
import {
  prepareWebPalaceRegistration,
  WebPalaceRegistrationError
} from "./webPalaceRegistration";
import {
  internalRouteExists,
  removeWebPalaceFile,
  registerWebPalaceFile,
  resolveInternalRouteFile
} from "./webPalaceRegistration.server";
import { prepareWebPalaceRemoval } from "./webPalaceRemoval";

function entry(id: string, href: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: id
      .split("-")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" "),
    subject: "Registration Test",
    destination: { type: "internal", href },
    status: "live",
    cluster: "Tests",
    summary: "A complete registry entry used to verify safe and idempotent registration.",
    tags: ["registration"],
    createdAt: "2026-07-24",
    ...overrides
  };
}

describe("Web Palace registration", () => {
  it("creates an entry, assigns a node, and is idempotent by stable ID", () => {
    const first = prepareWebPalaceRegistration(
      [],
      entry("new-palace", "/palaces/new-palace"),
      brainTraceNodes.length,
      () => true
    );
    const second = prepareWebPalaceRegistration(
      first.registry,
      entry("new-palace", "/palaces/new-palace", { title: "Updated Palace" }),
      brainTraceNodes.length,
      () => true
    );

    expect(first.action).toBe("created");
    expect(second.action).toBe("id");
    expect(second.registry).toHaveLength(1);
    expect(second.entry.title).toBe("Updated Palace");
    expect(second.entry.traceNode).toBe(first.entry.traceNode);
  });

  it("falls back to destination identity without changing the stable ID or pin", () => {
    const current = [
      entry("stable-palace", "/palaces/stable", { traceNode: 700 })
    ];
    const result = prepareWebPalaceRegistration(
      current,
      entry("rediscovered-palace", "/palaces/stable", { title: "Rediscovered" }),
      brainTraceNodes.length,
      () => true
    );

    expect(result.action).toBe("destination");
    expect(result.entry.id).toBe("stable-palace");
    expect(result.entry.title).toBe("Rediscovered");
    expect(result.entry.traceNode).toBe(700);
    expect(result.registry).toHaveLength(1);
  });

  it("rejects split ID and destination identities", () => {
    try {
      prepareWebPalaceRegistration(
        [
          entry("alpha-palace", "/palaces/alpha"),
          entry("beta-palace", "/palaces/beta")
        ],
        entry("alpha-palace", "/palaces/beta"),
        brainTraceNodes.length,
        () => true
      );
      throw new Error("Expected identity conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(WebPalaceRegistrationError);
      expect((error as WebPalaceRegistrationError).code).toBe("IDENTITY_CONFLICT");
    }
  });

  it("requires every live internal destination to resolve", () => {
    try {
      prepareWebPalaceRegistration(
        [],
        entry("missing-palace", "/palaces/missing"),
        brainTraceNodes.length,
        () => false
      );
      throw new Error("Expected missing route failure");
    } catch (error) {
      expect(error).toBeInstanceOf(WebPalaceRegistrationError);
      expect((error as WebPalaceRegistrationError).code).toBe("INTERNAL_ROUTE_MISSING");
    }

    expect(() =>
      prepareWebPalaceRegistration(
        [],
        entry("queued-palace", "/palaces/future", { status: "queued" }),
        brainTraceNodes.length,
        () => false
      )
    ).not.toThrow();
  });

  it("resolves only route files inside the application directory", async () => {
    const appDirectory = join(process.cwd(), "src", "app");

    expect(resolveInternalRouteFile(appDirectory, "/create")).not.toBeNull();
    expect(await internalRouteExists(appDirectory, "/create")).toBe(true);
    expect(await internalRouteExists(appDirectory, "/palaces/not-real")).toBe(false);
    expect(resolveInternalRouteFile(appDirectory, "/../../outside")).toBeNull();
  });

  it("writes assigned nodes to a registry file atomically", async () => {
    const root = join(process.cwd(), "tmp", `registration-${Date.now()}`);
    const appDirectory = join(root, "app");
    const registryPath = join(root, "registry.json");
    await mkdir(join(appDirectory, "palaces", "new-palace"), { recursive: true });
    await writeFile(join(appDirectory, "palaces", "new-palace", "page.tsx"), "export default 1;");
    await writeFile(registryPath, "[]\n");

    const result = await registerWebPalaceFile({
      registryPath,
      appDirectory,
      candidate: entry("new-palace", "/palaces/new-palace")
    });
    const persisted = JSON.parse(await readFile(registryPath, "utf8"));

    expect(result.action).toBe("created");
    expect(persisted).toEqual(result.registry);
    expect(persisted[0].traceNode).toBeTypeOf("number");
  });

  it("checks normalized internal routes before writing", async () => {
    const root = join(process.cwd(), "tmp", `registration-normalized-${Date.now()}`);
    const appDirectory = join(root, "app");
    const registryPath = join(root, "registry.json");
    await mkdir(join(appDirectory, "palaces", "new-palace"), { recursive: true });
    await writeFile(join(appDirectory, "palaces", "new-palace", "page.tsx"), "export default 1;");
    await writeFile(registryPath, "[]\n");

    const result = await registerWebPalaceFile({
      registryPath,
      appDirectory,
      candidate: entry("new-palace", "/palaces/new-palace/")
    });

    expect(result.entry.destination.href).toBe("/palaces/new-palace");
  });

  it("removes exactly one registry record without touching the remaining entry", () => {
    const current = [
      entry("alpha-palace", "/palaces/alpha", { traceNode: 700 }),
      entry("beta-palace", "/palaces/beta", { traceNode: 296 })
    ];
    const result = prepareWebPalaceRemoval(
      current,
      "alpha-palace",
      brainTraceNodes.length
    );

    expect(result.removed.id).toBe("alpha-palace");
    expect(result.registry).toEqual([current[1]]);
    expect(() =>
      prepareWebPalaceRemoval(current, "missing-palace", brainTraceNodes.length)
    ).toThrow(/no longer contains/);
  });

  it("creates a recoverable backup before removing a registry record", async () => {
    const root = join(process.cwd(), "tmp", `removal-${Date.now()}`);
    const registryPath = join(root, "registry.json");
    const backupDirectory = join(root, "backups");
    const original = [
      entry("alpha-palace", "/palaces/alpha", { traceNode: 700 }),
      entry("beta-palace", "/palaces/beta", { traceNode: 296 })
    ];
    await mkdir(root, { recursive: true });
    await writeFile(registryPath, `${JSON.stringify(original, null, 2)}\n`);

    const result = await removeWebPalaceFile({
      registryPath,
      backupDirectory,
      id: "alpha-palace"
    });
    const persisted = JSON.parse(await readFile(registryPath, "utf8"));
    const backup = JSON.parse(await readFile(result.backupFile, "utf8"));

    expect(persisted.map((item: { id: string }) => item.id)).toEqual(["beta-palace"]);
    expect(backup).toEqual(original);
    expect(result.removed.id).toBe("alpha-palace");
  });
});
