import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { brainTraceNodes } from "../data/brainTrace";
import {
  prepareWebPalaceRegistration,
  WebPalaceRegistrationError,
  type WebPalaceRegistrationResult
} from "./webPalaceRegistration";
import { validateWebPalaceRegistry } from "./webPalaceRegistry";
import {
  prepareWebPalaceRemoval,
  type WebPalaceRemovalResult
} from "./webPalaceRemoval";

const pageExtensions = [".tsx", ".ts", ".jsx", ".js"];

export function resolveInternalRouteFile(appDirectory: string, href: string) {
  const rawPath = href.split(/[?#]/, 1)[0];
  const rawSegments = rawPath.split("/").filter(Boolean);

  try {
    if (rawSegments.some((segment) => {
      const decodedSegment = decodeURIComponent(segment);
      return decodedSegment === "." || decodedSegment === "..";
    })) {
      return null;
    }
  } catch {
    return null;
  }

  const url = new URL(href, "http://web-palace.local");
  const decodedPath = decodeURIComponent(url.pathname);
  const segments = decodedPath.split("/").filter(Boolean);

  const appRoot = resolve(appDirectory);
  const routeDirectory = resolve(appRoot, ...segments);
  const relativeRoute = relative(appRoot, routeDirectory);

  if (relativeRoute.startsWith(`..${sep}`) || relativeRoute === "..") {
    return null;
  }

  return pageExtensions.map((extension) => join(routeDirectory, `page${extension}`));
}

export async function internalRouteExists(appDirectory: string, href: string) {
  const candidates = resolveInternalRouteFile(appDirectory, href);

  if (!candidates) {
    return false;
  }

  for (const candidate of candidates) {
    try {
      const metadata = await stat(candidate);

      if (metadata.isFile() && pageExtensions.includes(extname(candidate))) {
        return true;
      }
    } catch {
      // Try the next supported page extension.
    }
  }

  return false;
}

export type RegisterWebPalaceFileOptions = {
  registryPath: string;
  appDirectory: string;
  candidate: unknown;
};

export type RemoveWebPalaceFileOptions = {
  registryPath: string;
  backupDirectory: string;
  id: string;
};

export type RemoveWebPalaceFileResult = WebPalaceRemovalResult & {
  backupFile: string;
};

/**
 * Safely registers one palace against the latest on-disk registry. The
 * optimistic re-read prevents a concurrent Add Node request from being lost,
 * and the same-directory rename keeps the final JSON replacement atomic.
 */
export async function registerWebPalaceFile({
  registryPath,
  appDirectory,
  candidate
}: RegisterWebPalaceFileOptions): Promise<WebPalaceRegistrationResult> {
  const absoluteRegistryPath = resolve(registryPath);
  let originalText: string;

  try {
    originalText = await readFile(absoluteRegistryPath, "utf8");
  } catch (error) {
    throw new WebPalaceRegistrationError(
      `Unable to read the Web Palace registry: ${error instanceof Error ? error.message : "unknown error"}`,
      "REGISTRY_IO"
    );
  }

  let currentValue: unknown;

  try {
    currentValue = JSON.parse(originalText);
  } catch {
    throw new WebPalaceRegistrationError(
      "The Web Palace registry is not valid JSON.",
      "REGISTRY_IO"
    );
  }

  const normalizedCurrent = validateWebPalaceRegistry(currentValue, brainTraceNodes.length);
  const [normalizedCandidate] = validateWebPalaceRegistry(
    [candidate],
    brainTraceNodes.length
  );
  const routeChecks = new Map<string, boolean>();
  const hrefs = [
    ...normalizedCurrent.flatMap((entry) =>
      entry.destination.type === "internal" ? [entry.destination.href] : []
    ),
    ...(normalizedCandidate.destination.type === "internal"
      ? [normalizedCandidate.destination.href]
      : [])
  ];

  await Promise.all(
    hrefs.map(async (href) => routeChecks.set(href, await internalRouteExists(appDirectory, href)))
  );

  const result = prepareWebPalaceRegistration(
    normalizedCurrent,
    normalizedCandidate,
    brainTraceNodes.length,
    (href) => routeChecks.get(href) ?? false
  );
  const latestText = await readFile(absoluteRegistryPath, "utf8");

  if (latestText !== originalText) {
    throw new WebPalaceRegistrationError(
      "The registry changed during registration. Reload it and try again.",
      "REGISTRY_CHANGED"
    );
  }

  const temporaryPath = join(
    dirname(absoluteRegistryPath),
    `.${randomUUID()}.web-palace-registry.tmp`
  );

  try {
    await writeFile(temporaryPath, `${JSON.stringify(result.registry, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(temporaryPath, absoluteRegistryPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw new WebPalaceRegistrationError(
      `Unable to update the Web Palace registry: ${error instanceof Error ? error.message : "unknown error"}`,
      "REGISTRY_IO"
    );
  }

  return result;
}

/**
 * Removes only one registry record. The original JSON is copied to a unique
 * local backup before the same optimistic and atomic replacement used by
 * registration. Website routes, components, and assets are never touched.
 */
export async function removeWebPalaceFile({
  registryPath,
  backupDirectory,
  id
}: RemoveWebPalaceFileOptions): Promise<RemoveWebPalaceFileResult> {
  const absoluteRegistryPath = resolve(registryPath);
  const absoluteBackupDirectory = resolve(backupDirectory);
  let originalText: string;

  try {
    originalText = await readFile(absoluteRegistryPath, "utf8");
  } catch (error) {
    throw new WebPalaceRegistrationError(
      `Unable to read the Web Palace registry: ${error instanceof Error ? error.message : "unknown error"}`,
      "REGISTRY_IO"
    );
  }

  let currentValue: unknown;

  try {
    currentValue = JSON.parse(originalText);
  } catch {
    throw new WebPalaceRegistrationError(
      "The Web Palace registry is not valid JSON.",
      "REGISTRY_IO"
    );
  }

  const result = prepareWebPalaceRemoval(currentValue, id, brainTraceNodes.length);
  const latestText = await readFile(absoluteRegistryPath, "utf8");

  if (latestText !== originalText) {
    throw new WebPalaceRegistrationError(
      "The registry changed during removal. Reload it and try again.",
      "REGISTRY_CHANGED"
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = join(
    absoluteBackupDirectory,
    `webPalaceRegistry.${timestamp}.${randomUUID()}.json`
  );
  const temporaryPath = join(
    dirname(absoluteRegistryPath),
    `.${randomUUID()}.web-palace-registry.tmp`
  );

  try {
    await mkdir(absoluteBackupDirectory, { recursive: true });
    await writeFile(backupFile, originalText, { encoding: "utf8", flag: "wx" });
    await writeFile(temporaryPath, `${JSON.stringify(result.registry, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(temporaryPath, absoluteRegistryPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw new WebPalaceRegistrationError(
      `Unable to remove the Web Palace node: ${error instanceof Error ? error.message : "unknown error"}`,
      "REGISTRY_IO"
    );
  }

  return { ...result, backupFile };
}
