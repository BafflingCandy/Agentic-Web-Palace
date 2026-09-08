import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  parseRegistrationCommandArgs,
  WebPalaceCommandError
} from "./webPalaceRegistrationCommand";

const execFileAsync = promisify(execFile);

const requiredArgs = [
  "--id",
  "research-library",
  "--title",
  "Research Library",
  "--subject",
  "Research",
  "--destination",
  "/palaces/research-library",
  "--summary",
  "A focused research website with practical notes and references.",
  "--tags",
  "research, notes, reference"
];

describe("Web Palace registration command", () => {
  it("maps command flags to the shared registry candidate model", () => {
    const result = parseRegistrationCommandArgs(
      [
        ...requiredArgs,
        "--cluster",
        "Personal Knowledge",
        "--status",
        "queued",
        "--trace-node",
        "42"
      ],
      new Date("2026-07-24T12:00:00.000Z")
    );

    expect(result).toEqual({
      help: false,
      candidate: {
        id: "research-library",
        title: "Research Library",
        subject: "Research",
        destination: {
          type: "internal",
          href: "/palaces/research-library"
        },
        status: "queued",
        cluster: "Personal Knowledge",
        summary: "A focused research website with practical notes and references.",
        tags: ["research", "notes", "reference"],
        createdAt: "2026-07-24",
        traceNode: 42
      }
    });
  });

  it("supports external destinations and defaults optional metadata", () => {
    const args = [...requiredArgs];
    args[args.indexOf("/palaces/research-library")] = "https://example.com/research";
    const result = parseRegistrationCommandArgs(
      args,
      new Date("2026-07-24T12:00:00.000Z")
    );

    expect(result.help).toBe(false);

    if (!result.help) {
      expect(result.candidate.destination).toEqual({
        type: "external",
        href: "https://example.com/research"
      });
      expect(result.candidate.cluster).toBe("Research");
      expect(result.candidate.status).toBe("live");
    }
  });

  it("handles help without requiring registration metadata", () => {
    expect(parseRegistrationCommandArgs(["--help"])).toEqual({ help: true });
    expect(parseRegistrationCommandArgs(["-h"])).toEqual({ help: true });
  });

  it("rejects missing, unknown, duplicate, and malformed options", () => {
    expect(() => parseRegistrationCommandArgs([])).toThrow(WebPalaceCommandError);
    expect(() =>
      parseRegistrationCommandArgs([...requiredArgs, "--unknown", "value"])
    ).toThrow(/Unknown option/);
    expect(() =>
      parseRegistrationCommandArgs([...requiredArgs, "--id", "another"])
    ).toThrow(/more than once/);
    expect(() =>
      parseRegistrationCommandArgs([...requiredArgs, "--status", "draft"])
    ).toThrow(/live or queued/);
    expect(() =>
      parseRegistrationCommandArgs([...requiredArgs, "--trace-node", "4.5"])
    ).toThrow(/integer/);
  });

  it("runs the executable idempotently against an isolated repository", async () => {
    const projectRoot = process.cwd();
    const fixtureRoot = join(projectRoot, "tmp", `command-${Date.now()}`);
    const routeDirectory = join(
      fixtureRoot,
      "src",
      "app",
      "palaces",
      "research-library"
    );
    await mkdir(routeDirectory, { recursive: true });
    await mkdir(join(fixtureRoot, "src", "data"), { recursive: true });
    await writeFile(
      join(routeDirectory, "page.tsx"),
      "export default function Page() { return null; }\n"
    );
    await writeFile(
      join(fixtureRoot, "src", "data", "webPalaceRegistry.json"),
      "[]\n"
    );

    const tsxCli = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const command = join(projectRoot, "scripts", "register-web-palace.ts");
    const commandArgs = [
      tsxCli,
      command,
      ...requiredArgs,
      "--created-at",
      "2026-07-24"
    ];
    const first = await execFileAsync(process.execPath, commandArgs, {
      cwd: fixtureRoot
    });
    const second = await execFileAsync(process.execPath, commandArgs, {
      cwd: fixtureRoot
    });
    const registry = JSON.parse(
      await readFile(
        join(fixtureRoot, "src", "data", "webPalaceRegistry.json"),
        "utf8"
      )
    );

    expect(JSON.parse(first.stdout)).toMatchObject({
      ok: true,
      action: "created",
      id: "research-library"
    });
    expect(JSON.parse(second.stdout)).toMatchObject({
      ok: true,
      action: "id",
      id: "research-library"
    });
    expect(registry).toHaveLength(1);
    expect(registry[0].traceNode).toBeTypeOf("number");
  });
});
