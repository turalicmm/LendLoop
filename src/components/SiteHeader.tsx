"use client";

// Client component on purpose: the client <Show> reads Clerk's browser state,
// so pages stay prerenderable instead of reading auth on the server.
import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Lend<span className="text-accent">Loop</span>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Show when="signed-in">
            <Link href="/dashboard" className="font-medium hover:text-accent">
              Dashboard
            </Link>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-line/40">
                Sign in
              </button>
            </SignInButton>
          </Show>
        </nav>
      </div>
    </header>
  );
}
