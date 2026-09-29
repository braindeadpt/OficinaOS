import { useState } from "react";

const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

function detectModifierLabel(): string {
  if (typeof navigator === "undefined") {
    return "Ctrl K";
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;
  return APPLE_PLATFORM.test(platform) ? "⌘K" : "Ctrl K";
}

/**
 * The Cmd/Ctrl chord as the reader's platform writes it, resolved once on
 * mount since the platform cannot change under us. Read through state rather
 * than calling detectModifierLabel during render, so server and client agree
 * on the first paint and React does not warn about a hydration mismatch.
 */
export function useShortcutLabel(): string {
  const [label] = useState(detectModifierLabel);
  return label;
}
