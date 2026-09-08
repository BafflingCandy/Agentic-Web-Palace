import type { WebPalaceSeed } from "./webPalaceRegistry";

export type AddNodeField =
  | "title"
  | "subject"
  | "destination"
  | "summary"
  | "tags"
  | "cluster"
  | "status";

export type AddNodeFieldErrors = Partial<Record<AddNodeField, string>>;

export type AddNodeParseResult =
  | { success: true; candidate: WebPalaceSeed }
  | { success: false; errors: AddNodeFieldErrors };

function readFormString(formData: FormData, name: AddNodeField) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function isLocalMutationHost(hostHeader: string | null) {
  if (!hostHeader) {
    return false;
  }

  const hostname = hostHeader.startsWith("[")
    ? hostHeader.slice(1, hostHeader.indexOf("]"))
    : hostHeader.split(":")[0];

  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function parseAddNodeFormData(
  formData: FormData,
  today = new Date()
): AddNodeParseResult {
  const title = readFormString(formData, "title");
  const subject = readFormString(formData, "subject");
  const destinationHref = readFormString(formData, "destination");
  const summary = readFormString(formData, "summary");
  const tagsValue = readFormString(formData, "tags");
  const clusterValue = readFormString(formData, "cluster");
  const statusValue = readFormString(formData, "status") || "live";
  const errors: AddNodeFieldErrors = {};
  const id = slugify(title);

  if (title.length < 2 || title.length > 80) {
    errors.title = "Use between 2 and 80 characters.";
  } else if (!id) {
    errors.title = "Use at least one letter or number.";
  }

  if (subject.length < 2 || subject.length > 100) {
    errors.subject = "Use between 2 and 100 characters.";
  }

  if (
    !destinationHref ||
    destinationHref.length > 500 ||
    (destinationHref.startsWith("//") ||
      (!destinationHref.startsWith("/") &&
      !/^https?:\/\//i.test(destinationHref))
    )
  ) {
    errors.destination = "Enter an internal /route or an absolute HTTP(S) URL.";
  }

  if (summary.length < 12 || summary.length > 280) {
    errors.summary = "Use between 12 and 280 characters.";
  }

  const tags = tagsValue
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);

  if (tags.length === 0 || tags.some((tag) => tag.length > 40)) {
    errors.tags = "Add 1–12 comma-separated tags, each under 40 characters.";
  }

  const cluster = clusterValue || subject;

  if (cluster.length < 2 || cluster.length > 80) {
    errors.cluster = "Use between 2 and 80 characters.";
  }

  if (statusValue !== "live" && statusValue !== "queued") {
    errors.status = "Choose live or queued.";
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    candidate: {
      id,
      title,
      subject,
      destination: destinationHref.startsWith("/")
        ? { type: "internal", href: destinationHref }
        : { type: "external", href: destinationHref },
      status: statusValue as "live" | "queued",
      cluster,
      summary,
      tags,
      createdAt: today.toISOString().slice(0, 10)
    }
  };
}
