"use client";

import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";

const primary =
  "inline-block rounded-lg bg-accent px-4 py-2 font-medium text-white hover:opacity-90 dark:text-[#10241a]";

export function HeroActions() {
  return (
    <div>
      <Show when="signed-out">
        <SignInButton mode="modal" forceRedirectUrl="/dashboard">
          <button className={primary}>Sign in to lend or borrow</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link href="/dashboard" className={primary}>
          Go to your dashboard
        </Link>
      </Show>
    </div>
  );
}
