"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { join } from "node:path";
import { isLocalMutationHost } from "@/lib/webPalaceAddNode";
import { removeWebPalaceFile } from "@/lib/webPalaceRegistration.server";
import { WebPalaceRegistrationError } from "@/lib/webPalaceRegistration";

export type RemoveNodeActionState = {
  status: "idle" | "error" | "success";
  message: string;
  removedId?: string;
};

export async function removeWebPalaceNode(
  _previousState: RemoveNodeActionState,
  formData: FormData
): Promise<RemoveNodeActionState> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");

  if (process.env.NODE_ENV !== "development" || !isLocalMutationHost(host)) {
    return {
      status: "error",
      message: "Node management is available only from this device in local development."
    };
  }

  const idValue = formData.get("id");
  const confirmationValue = formData.get("confirmation");
  const id = typeof idValue === "string" ? idValue.trim() : "";

  if (confirmationValue !== "remove" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    return {
      status: "error",
      message: "The removal confirmation was incomplete. Nothing was changed."
    };
  }

  try {
    const result = await removeWebPalaceFile({
      registryPath: join(process.cwd(), "src", "data", "webPalaceRegistry.json"),
      backupDirectory: join(process.cwd(), "backups", "web-palace-registry"),
      id
    });

    revalidatePath("/");

    return {
      status: "success",
      message: `${result.removed.title} was removed from the brain. Its website files were kept and a registry backup was created.`,
      removedId: result.removed.id
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof WebPalaceRegistrationError
          ? error.message
          : "The node could not be removed. Nothing was changed."
    };
  }
}
