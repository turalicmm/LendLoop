import { HeroActions } from "@/components/HeroActions";
import { PublicToolList } from "@/components/PublicToolList";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10">
        <section className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Borrow what you need.
            <br />
            <span className="text-accent">Lend what you don&apos;t.</span>
          </h1>
          <p className="max-w-xl text-muted">
            LendLoop is a tool-lending board for your neighbourhood. List the drill you use twice a
            year, borrow a tent for the weekend, and let the reminders take care of themselves.
          </p>
          <HeroActions />
        </section>
        <PublicToolList />
      </main>
    </>
  );
}
