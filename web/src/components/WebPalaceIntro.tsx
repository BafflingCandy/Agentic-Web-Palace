"use client";

import { ShaderAnimation } from "@/components/ui/shader-lines";

export type WebPalaceIntroPhase =
  | "waiting"
  | "text-in"
  | "animation-in"
  | "text-out"
  | "animation-out"
  | "brain-in";

export function WebPalaceIntro({
  phase,
  onReady
}: {
  phase: WebPalaceIntroPhase;
  onReady: () => void;
}) {
  return (
    <div
      className={`web-palace-intro phase-${phase}`}
      aria-label="Welcome to Web Palace"
    >
      <ShaderAnimation onReady={onReady} />
      <span className="web-palace-intro__copy">
        <span>Welcome to</span>
        <strong>Web Palace</strong>
      </span>
    </div>
  );
}
