"use client";

import { useSyncExternalStore } from "react";
import { todayIso } from "@convex/lib/validation";

// Convex queries take "today" as an argument (they must not read the clock),
// and Next.js must not read it while prerendering. This hook returns null on
// the server, today's UTC date in the browser, and re-renders when the date
// changes while the page stays open.

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
}

export function useToday(): string | null {
  return useSyncExternalStore(subscribe, todayIso, () => null);
}
