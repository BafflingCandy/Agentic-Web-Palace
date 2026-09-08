"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { join } from "node:path";
import {
  isLocalMutationHost,
  parseAddNodeFormData,
  type AddNodeFieldErrors
} from "@/lib/webPalaceAddNode";
import { registerWebPalaceFile } from "@/lib/webPalaceRegistration.server";
import { WebPalaceRegistrationError } from "@/lib/webPalaceRegistration";
import type { WebPalaceEntry } from "@/lib/webPalaceRegistry";

export type AddNodeActionState = {
  status: "idle" | "error" | "success";
  message: string;
  errors?: AddNodeFieldErrors;
  entry?: WebPalaceEntry;
};

export async function addWebPalaceNode(
  _previousState: AddNodeActionState,
  formData: FormData
): Promise<AddNodeActionState> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");

  if (process.env.NODE_ENV !== "development" || !isLocalMutationHost(host)) {
    return {
      status: "error",
      message: "Add Node is available only from this device in local development."
    };
  }

  const parsed = parseAddNodeFormData(formData);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      errors: parsed.errors
    };
  }

  try {
    const result = await registerWebPalaceFile({
      registryPath: join(process.cwd(), "src", "data", "webPalaceRegistry.json"),
      appDirectory: join(process.cwd(), "src", "app"),
      candidate: parsed.candidate
    });

    revalidatePath("/");

    return {
      status: "success",
      message:
        result.action === "created"
          ? `${result.entry.title} was added to the brain.`
          : `${result.entry.title} was updated without creating a duplicate.`,
      entry: result.entry
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof WebPalaceRegistrationError
          ? error.message
          : "The node could not be added. Nothing was changed."
    };
  }
}
