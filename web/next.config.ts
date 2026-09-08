import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    // `next dev` and `next build` must not replace one another's chunk maps.
    // Keeping separate outputs prevents missing-chunk errors while the local
    // studio remains open during a production verification build.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    images: {
      formats: ["image/avif", "image/webp"]
    }
  };
}
