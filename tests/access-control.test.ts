import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { LIMITS } from "../convex/lib/constants";
import { inDays, listDrill, setup, signIn, today, tomorrow } from "./helpers";

describe("public catalogue", () => {
  test("shows name and category of available tools only, never the owner", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    await listDrill(alice.client);

    const publicList = await t.query(api.tools.listPublic, { today: today() });
    expect(publicList).toHaveLength(1);
    expect(Object.keys(publicList[0]).sort()).toEqual(["category", "id", "name"]);
  });

  test("hides a tool while it is lent out, and removed listings", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);
    const removedId = await listDrill(alice.client);
    await alice.client.mutation(api.tools.remove, { toolId: removedId });
    const loanId = await bob.client.mutation(api.loans.request, {
      toolId,
      startDate: tomorrow(),
      endDate: inDays(2),
    });
    await alice.client.mutation(api.loans.approve, { loanId });
    await t.run(async (ctx) => ctx.db.patch("loans", loanId, { startDate: today() }));

    expect(await t.query(api.tools.listPublic, { today: today() })).toHaveLength(0);
  });

  test("rejects a malformed date instead of guessing", async () => {
    const t = setup();
    await expect(t.query(api.tools.listPublic, { today: "yesterday" })).rejects.toThrow(
      /calendar date/,
    );
  });

  test("anonymous callers can't use signed-in functions", async () => {
    const t = setup();
    await expect(
      t.mutation(api.tools.create, {
        name: "Ladder",
        category: "hand_tools",
        condition: "fair",
        description: "3 m",
      }),
    ).rejects.toThrow(/Sign in/);
  });
});

describe("listing ownership", () => {
  test("a user can't edit or remove someone else's listing", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const mallory = await signIn(t, "Mallory");
    const toolId = await listDrill(alice.client);

    await expect(
      mallory.client.mutation(api.tools.update, {
        toolId,
        name: "Mine now",
        category: "power_tools",
        condition: "good",
        description: "x",
      }),
    ).rejects.toThrow(/your own listings/);
    await expect(mallory.client.mutation(api.tools.remove, { toolId })).rejects.toThrow(
      /your own listings/,
    );
  });

  test("an admin can remove any listing and open requests are closed", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const admin = await signIn(t, "Ada", { admin: true });
    const toolId = await listDrill(alice.client);
    const loanId = await bob.client.mutation(api.loans.request, {
      toolId,
      startDate: tomorrow(),
      endDate: inDays(3),
    });

    await admin.client.mutation(api.tools.remove, { toolId });

    const loan = await t.run(async (ctx) => ctx.db.get("loans", loanId));
    expect(loan?.status).toBe("cancelled");
    const events = await t.run(async (ctx) => ctx.db.query("outbox").take(10));
    expect(events.map((e) => e.type)).toEqual(["loan.requested", "loan.listing_removed"]);
  });

  test("removing a tool closes every open request, even a long queue", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);
    // More open requests than one batch closes. Written directly, because
    // the per-user request limits would stop them through the API.
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("loans", {
          toolId,
          ownerId: alice.id,
          borrowerId: bob.id,
          startDate: tomorrow(),
          endDate: tomorrow(),
          status: "requested",
        });
      }
    });

    await alice.client.mutation(api.tools.remove, { toolId });
    // Runs the scheduled follow-up batch (and the deliveries, which fail
    // here because no webhook is configured).
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [open, notices] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db
          .query("loans")
          .withIndex("by_toolId_and_status", (q) => q.eq("toolId", toolId).eq("status", "requested"))
          .take(100),
        ctx.db.query("outbox").take(200),
      ]),
    );
    expect(open).toHaveLength(0);
    // Every borrower is told exactly once.
    const removed = notices.filter((e) => e.type === "loan.listing_removed");
    expect(removed).toHaveLength(60);
    expect(new Set(removed.map((e) => e.loanId)).size).toBe(60);
  });

  test("only admins can mark a Trusted Lender", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const admin = await signIn(t, "Ada", { admin: true });

    await expect(
      alice.client.mutation(api.admin.setTrustedLender, { userId: alice.id, trusted: true }),
    ).rejects.toThrow(/Only admins/);
    await admin.client.mutation(api.admin.setTrustedLender, { userId: alice.id, trusted: true });
    const me = await alice.client.query(api.users.me, {});
    expect(me?.trustedLender).toBe(true);
  });

  test("only admins can see all loans", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    await expect(alice.client.query(api.admin.allLoans, { today: today() })).rejects.toThrow(
      /Only admins/,
    );
  });

  test("setRole updates every account that shares the email", async () => {
    const t = setup();
    const a = await signIn(t, "Sam", { email: "sam@example.test", issuer: "clerk-dev" });
    const b = await signIn(t, "Sam", { email: "sam@example.test", issuer: "clerk-prod" });
    await t.mutation(internal.admin.setRole, { email: "sam@example.test", role: "admin" });
    const roles = await t.run(async (ctx) =>
      Promise.all([ctx.db.get("users", a.id), ctx.db.get("users", b.id)]),
    );
    expect(roles.map((u) => u?.role)).toEqual(["admin", "admin"]);
  });
});

describe("borrowing rules", () => {
  test("you can't borrow your own tool or request past dates", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);

    await expect(
      alice.client.mutation(api.loans.request, { toolId, startDate: tomorrow(), endDate: inDays(2) }),
    ).rejects.toThrow(/own tool/);
    await expect(
      bob.client.mutation(api.loans.request, { toolId, startDate: inDays(-1), endDate: inDays(2) }),
    ).rejects.toThrow(/past/);
  });

  test("only the lender decides, and approving declines overlapping requests", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const carol = await signIn(t, "Carol");
    const toolId = await listDrill(alice.client);

    const bobLoan = await bob.client.mutation(api.loans.request, {
      toolId,
      startDate: inDays(1),
      endDate: inDays(3),
    });
    const carolLoan = await carol.client.mutation(api.loans.request, {
      toolId,
      startDate: inDays(2),
      endDate: inDays(4),
    });

    await expect(carol.client.mutation(api.loans.approve, { loanId: bobLoan })).rejects.toThrow(
      /Only the lender/,
    );
    await alice.client.mutation(api.loans.approve, { loanId: bobLoan });

    const [bobRow, carolRow] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get("loans", bobLoan), ctx.db.get("loans", carolLoan)]),
    );
    expect(bobRow?.status).toBe("approved");
    expect(carolRow?.status).toBe("declined");

    // Each event goes to exactly the person it concerns.
    const outbox = await t.run(async (ctx) => ctx.db.query("outbox").take(10));
    expect(outbox.map((e) => [e.type, e.recipientId])).toEqual([
      ["loan.requested", alice.id],
      ["loan.requested", alice.id],
      ["loan.approved", bob.id],
      ["loan.declined", carol.id],
    ]);
  });

  test("only the lender marks a loan returned, and only once it has started", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);
    const loanId = await bob.client.mutation(api.loans.request, {
      toolId,
      startDate: tomorrow(),
      endDate: inDays(2),
    });
    await alice.client.mutation(api.loans.approve, { loanId });

    await expect(alice.client.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(
      /hasn't started/,
    );
    await t.run(async (ctx) => ctx.db.patch("loans", loanId, { startDate: today() }));
    await expect(bob.client.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(
      /Only the lender/,
    );
    await alice.client.mutation(api.loans.markReturned, { loanId });
    const loan = await t.run(async (ctx) => ctx.db.get("loans", loanId));
    expect(loan?.status).toBe("returned");
  });

  test("the two people on a loan see each other's email only once it is approved", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);
    const loanId = await bob.client.mutation(api.loans.request, {
      toolId,
      startDate: tomorrow(),
      endDate: inDays(2),
    });
    const [pending] = await bob.client.query(api.loans.myRequests, { today: today() });
    expect(pending.counterparty.email).toBeUndefined();
    const [incoming] = await alice.client.query(api.loans.incoming, { today: today() });
    expect(incoming.counterparty.email).toBeUndefined();

    await alice.client.mutation(api.loans.approve, { loanId });
    const [approved] = await bob.client.query(api.loans.myRequests, { today: today() });
    expect(approved.counterparty.email).toBe("alice@example.test");
    const [lenderView] = await alice.client.query(api.loans.incoming, { today: today() });
    expect(lenderView.counterparty.email).toBe("bob@example.test");

    // Once it's over, contact details go away again.
    await t.run(async (ctx) => ctx.db.patch("loans", loanId, { startDate: today() }));
    await alice.client.mutation(api.loans.markReturned, { loanId });
    const [returned] = await bob.client.query(api.loans.myRequests, { today: today() });
    expect(returned.counterparty.email).toBeUndefined();
  });

  test("other people's requests stay private, and only the two people on a loan see its message", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const mallory = await signIn(t, "Mallory");
    const toolId = await listDrill(alice.client);
    await bob.client.mutation(api.loans.request, {
      toolId,
      startDate: tomorrow(),
      endDate: inDays(2),
      message: "For the shelves",
    });

    expect(await mallory.client.query(api.loans.incoming, { today: today() })).toHaveLength(0);
    expect(await mallory.client.query(api.loans.myRequests, { today: today() })).toHaveLength(0);
    const [incoming] = await alice.client.query(api.loans.incoming, { today: today() });
    expect(incoming.message).toBe("For the shelves");
    const [mine] = await bob.client.query(api.loans.myRequests, { today: today() });
    expect(mine.message).toBe("For the shelves");
  });
});

describe("request limits (lenders can't be spammed)", () => {
  test("at most two open requests per tool per borrower", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);
    await bob.client.mutation(api.loans.request, { toolId, startDate: inDays(1), endDate: inDays(1) });
    await bob.client.mutation(api.loans.request, { toolId, startDate: inDays(3), endDate: inDays(3) });
    await expect(
      bob.client.mutation(api.loans.request, { toolId, startDate: inDays(5), endDate: inDays(5) }),
    ).rejects.toThrow(/open requests for this tool/);
  });

  test("request-and-cancel churn is capped per hour", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);
    for (let i = 0; i < 10; i++) {
      const loanId = await bob.client.mutation(api.loans.request, {
        toolId,
        startDate: tomorrow(),
        endDate: tomorrow(),
      });
      await bob.client.mutation(api.loans.cancel, { loanId });
    }
    await expect(
      bob.client.mutation(api.loans.request, { toolId, startDate: tomorrow(), endDate: tomorrow() }),
    ).rejects.toThrow(/try again later/);
  });
});

describe("nothing a user types becomes a link in someone else's email", () => {
  test("a display name made of a link is dropped", async () => {
    const t = setup();
    const mallory = await signIn(t, "https://evil.example/login", { email: "mallory@example.test" });
    expect((await mallory.client.query(api.users.me, {}))?.name).toBe("mallory");
    const ana = await signIn(t, "Ana-Marija O'Neil", { email: "ana@example.test" });
    expect((await ana.client.query(api.users.me, {}))?.name).toBe("Ana-Marija O'Neil");
  });

  test("a tool name can't carry a link, and a description keeps its line breaks", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const fields = { category: "other" as const, condition: "good" as const, description: "x" };
    await expect(
      alice.client.mutation(api.tools.create, { ...fields, name: "Free drill at www.evil.example" }),
    ).rejects.toThrow(/can't contain a link/);
    const toolId = await alice.client.mutation(api.tools.create, {
      ...fields,
      name: "Ladder",
      description: "Line one\n\n\n\nLine   two",
    });
    const tool = await t.run(async (ctx) => ctx.db.get("tools", toolId));
    expect(tool?.description).toBe("Line one\n\nLine two");
  });
});

describe("one account can't flood the catalogue", () => {
  test("live listings are capped per user", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    await t.run(async (ctx) => {
      for (let i = 0; i < LIMITS.maxListingsPerUser; i++) {
        await ctx.db.insert("tools", {
          ownerId: alice.id,
          name: `Tool ${i}`,
          category: "other",
          condition: "good",
          description: "x",
        });
      }
    });
    await expect(listDrill(alice.client)).rejects.toThrow(/at most 50 listings/);
  });

  test("and so are new listings per hour", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    for (let i = 0; i < LIMITS.maxListingsPerHour; i++) {
      const toolId = await listDrill(alice.client);
      await alice.client.mutation(api.tools.remove, { toolId });
    }
    await expect(listDrill(alice.client)).rejects.toThrow(/last hour/);
  });
});

describe("dates the lender didn't act on", () => {
  test("a request whose first day passed can't be approved, and expires with a notice", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);
    const loanId = await bob.client.mutation(api.loans.request, { toolId, startDate: tomorrow(), endDate: inDays(2) });
    await t.run(async (ctx) => ctx.db.patch("loans", loanId, { startDate: inDays(-1) }));

    const [row] = await alice.client.query(api.loans.incoming, { today: today() });
    expect(row).toMatchObject({ canApprove: false, canDecline: true });
    await expect(alice.client.mutation(api.loans.approve, { loanId })).rejects.toThrow(/start date has passed/);

    expect(await t.mutation(internal.loans.expireUnanswered, {})).toBe(1);
    expect((await t.run(async (ctx) => ctx.db.get("loans", loanId)))?.status).toBe("declined");
    const outbox = await t.run(async (ctx) => ctx.db.query("outbox").take(10));
    expect(outbox.map((e) => [e.type, e.recipientId])).toContainEqual(["loan.expired", bob.id]);
  });

  test("approved days can't be requested again", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const carol = await signIn(t, "Carol");
    const toolId = await listDrill(alice.client);
    const loanId = await bob.client.mutation(api.loans.request, { toolId, startDate: inDays(3), endDate: inDays(5) });
    await alice.client.mutation(api.loans.approve, { loanId });
    await expect(
      carol.client.mutation(api.loans.request, { toolId, startDate: inDays(5), endDate: inDays(6) }),
    ).rejects.toThrow(/already booked/);
    await carol.client.mutation(api.loans.request, { toolId, startDate: inDays(6), endDate: inDays(7) });
  });

  test("a tool that hasn't come back from an overdue loan can't be booked again", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const carol = await signIn(t, "Carol");
    const toolId = await listDrill(alice.client);
    const loanId = await bob.client.mutation(api.loans.request, { toolId, startDate: tomorrow(), endDate: tomorrow() });
    await alice.client.mutation(api.loans.approve, { loanId });
    await t.run(async (ctx) => ctx.db.patch("loans", loanId, { startDate: inDays(-3), endDate: inDays(-2) }));

    await expect(
      carol.client.mutation(api.loans.request, { toolId, startDate: inDays(10), endDate: inDays(11) }),
    ).rejects.toThrow(/hasn't come back/);
    await alice.client.mutation(api.loans.markReturned, { loanId });
    await carol.client.mutation(api.loans.request, { toolId, startDate: inDays(10), endDate: inDays(11) });
  });
});
