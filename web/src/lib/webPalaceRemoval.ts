import {
  validateWebPalaceRegistry,
  type WebPalaceSeed
} from "./webPalaceRegistry";
import { WebPalaceRegistrationError } from "./webPalaceRegistration";

export type WebPalaceRemovalResult = {
  removed: WebPalaceSeed;
  registry: WebPalaceSeed[];
};

export function prepareWebPalaceRemoval(
  currentValue: unknown,
  id: string,
  nodeCount: number
): WebPalaceRemovalResult {
  const current = validateWebPalaceRegistry(currentValue, nodeCount);
  const normalizedId = id.trim();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedId)) {
    throw new WebPalaceRegistrationError(
      "Choose a valid website node to remove.",
      "IDENTITY_CONFLICT"
    );
  }

  const index = current.findIndex((entry) => entry.id === normalizedId);

  if (index < 0) {
    throw new WebPalaceRegistrationError(
      `The registry no longer contains "${normalizedId}". Reload and try again.`,
      "IDENTITY_CONFLICT"
    );
  }

  return {
    removed: current[index],
    registry: current.filter((_, entryIndex) => entryIndex !== index)
  };
}
