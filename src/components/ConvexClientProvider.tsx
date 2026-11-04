"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

/** Passes the Clerk session to Convex so functions see a verified identity. */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-sm">
        <h1 className="mb-2 text-lg font-semibold">LendLoop isn&apos;t connected to Convex yet</h1>
        <p className="text-muted">
          Run <code>npx convex dev</code> so it writes <code>NEXT_PUBLIC_CONVEX_URL</code> to{" "}
          <code>.env.local</code>, then restart the dev server. See the README.
        </p>
      </main>
    );
  }
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
