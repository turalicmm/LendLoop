"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AdminTab } from "./AdminTab";
import { BrowseTab } from "./BrowseTab";
import { ListingsTab } from "./ListingsTab";
import { LoansTab } from "./LoansTab";
import { ErrorText, Loading } from "../ui";
import { firstName } from "@convex/lib/validation";
import { errorMessage } from "@/lib/format";

const TABS = [
  { id: "browse", label: "All tools" },
  { id: "listings", label: "My listings" },
  { id: "requests", label: "My requests" },
  { id: "incoming", label: "Incoming requests" },
  { id: "admin", label: "Admin" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Creates the Convex user row from the Clerk identity once per session. */
function useEnsureUser() {
  const { isAuthenticated } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isAuthenticated) return;
    ensureUser().catch((e) => setError(errorMessage(e)));
  }, [isAuthenticated, ensureUser]);
  return error;
}

export function Dashboard() {
  const clerk = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const ensureError = useEnsureUser();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const visibleTabs = TABS.filter((tab) => tab.id !== "admin" || me?.role === "admin");
  const tab: TabId = visibleTabs.find((t) => t.id === params.get("tab"))?.id ?? "browse";

  if (ensureError) return <ErrorText>{ensureError}</ErrorText>;
  // Signed in with Clerk, but Convex rejected the token: usually a wrong
  // CLERK_JWT_ISSUER_DOMAIN or the Convex integration isn't active in Clerk.
  if (clerk.isLoaded && clerk.isSignedIn && !isLoading && !isAuthenticated) {
    return (
      <ErrorText>
        You are signed in, but the backend didn&apos;t accept your session. Check
        CLERK_JWT_ISSUER_DOMAIN and the Clerk Convex integration (README, step 2 and 3).
      </ErrorText>
    );
  }
  if (isLoading || !isAuthenticated || !me) return <Loading />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Hi {firstName(me.name)}</h1>
        <p className="text-sm text-muted">
          {me.role === "admin" ? "You are an admin. " : ""}
          {me.trustedLender ? "Neighbours see you as a Trusted Lender." : "Lend and borrow tools from your neighbours."}
        </p>
      </div>
      {/* Wraps on narrow screens rather than scrolling, so no tab is hidden off-screen. */}
      <nav className="flex flex-wrap gap-x-1 border-b border-line" aria-label="Dashboard sections">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => router.replace(`${pathname}?tab=${t.id}`, { scroll: false })}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "browse" && <BrowseTab isAdmin={me.role === "admin"} />}
      {tab === "listings" && <ListingsTab />}
      {tab === "requests" && <LoansTab view="borrower" />}
      {tab === "incoming" && <LoansTab view="lender" />}
      {tab === "admin" && <AdminTab />}
    </div>
  );
}
