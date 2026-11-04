import { Suspense } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { Loading } from "@/components/ui";

export default function DashboardPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <Suspense fallback={<Loading />}>
          <Dashboard />
        </Suspense>
      </main>
    </>
  );
}
