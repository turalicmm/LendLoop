import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { loanActivity } from "../convex/lib/loans";
import { CONFIRM_WITHIN_MS } from "../convex/notifications";
import { signRequest, verifySignature } from "../convex/lib/signing";
import { addDays, todayIso } from "../convex/lib/validation";
import { inDays, listDrill, setup, signIn, tomorrow } from "./helpers";

const SECRET = "test-secret-n8n-to-lendloop";

beforeEach(() => vi.stubEnv("N8N_TO_LENDLOOP_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

async function signedFetch(
  t: ReturnType<typeof setup>,
  method: "GET" | "POST",
  path: string,
  body = "",
  secret = SECRET,
) {
  const { timestamp, signature } = await signRequest(secret, method, path, body);
  return await t.fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-lendloop-timestamp": timestamp,
      "x-lendloop-signature": signature,
    },
    body: method === "POST" ? body : undefined,
  });
}

async function overdueLoan(t: ReturnType<typeof setup>) {
  const alice = await signIn(t, "Alice");
  const bob = await signIn(t, "Bob");
  const toolId = await listDrill(alice.client);
  const loanId = await bob.client.mutation(api.loans.request, {
    toolId,
    startDate: tomorrow(),
    endDate: inDays(2),
  });
  await alice.client.mutation(api.loans.approve, { loanId });
  const endDate = addDays(todayIso(), -2);
  await t.run(async (ctx) =>
    ctx.db.patch("loans", loanId, { startDate: addDays(endDate, -2), endDate }),
  );
  return { loanId, alice, bob };
}

function writeBack(
  loanId: string,
  key: string,
  status: "sent" | "failed",
  kind: "overdue_reminder" | "request_notification" = "overdue_reminder",
) {
  return JSON.stringify({
    idempotencyKey: key,
    loanId,
    kind,
    status,
    channel: "email",
    detail: status === "failed" ? "SMTP down" : undefined,
    occurredAt: new Date().toISOString(),
  });
}

describe("request signing", () => {
  test("accepts a fresh signature and rejects tampering, other paths and old timestamps", async () => {
    const now = 1_800_000_000;
    const { timestamp, signature } = await signRequest(SECRET, "POST", "/a", "{}", now);
    const base = { method: "POST", path: "/a", body: "{}", timestamp, signature };

    expect(await verifySignature(SECRET, base, now)).toEqual({ ok: true });
    expect((await verifySignature(SECRET, { ...base, body: '{"x":1}' }, now)).ok).toBe(false);
    expect((await verifySignature(SECRET, { ...base, path: "/b" }, now)).ok).toBe(false);
    expect((await verifySignature("other-secret", base, now)).ok).toBe(false);
    expect((await verifySignature(SECRET, base, now + 301)).ok).toBe(false);
  });
});

describe("overdue endpoint", () => {
  test("rejects unsigned and wrongly signed calls", async () => {
    const t = setup();
    expect((await t.fetch("/automation/overdue-loans", { method: "GET" })).status).toBe(401);
    const res = await signedFetch(t, "GET", "/automation/overdue-loans", "", "wrong-secret");
    expect(res.status).toBe(401);
  });

  test("returns only the fields a reminder needs", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);

    const res = await signedFetch(t, "GET", "/automation/overdue-loans");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.loans[0]).toEqual({
      loanId,
      reminderKey: `overdue:${loanId}:${todayIso()}`,
      borrower: { firstName: "Bob", email: "bob@example.test" },
      tool: { name: "Cordless drill" },
      dueDate: addDays(todayIso(), -2),
      daysOverdue: 2,
    });
  });
});

describe("write-backs are idempotent", () => {
  test("a retried write-back doesn't duplicate, and a later success replaces a failure", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const key = `overdue:${loanId}:${todayIso()}`;

    const first = await signedFetch(t, "POST", "/automation/events", writeBack(loanId, key, "failed"));
    expect(await first.json()).toEqual({ ok: true, result: "created" });
    const retry = await signedFetch(t, "POST", "/automation/events", writeBack(loanId, key, "failed"));
    expect(await retry.json()).toEqual({ ok: true, result: "duplicate" });
    const success = await signedFetch(t, "POST", "/automation/events", writeBack(loanId, key, "sent"));
    expect(await success.json()).toEqual({ ok: true, result: "updated" });
    const again = await signedFetch(t, "POST", "/automation/events", writeBack(loanId, key, "sent"));
    expect(await again.json()).toEqual({ ok: true, result: "duplicate" });

    const rows = await t.run(async (ctx) => ctx.db.query("reminders").take(10));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");

    // Once reminded today, the loan drops out of today's overdue list.
    const res = await signedFetch(t, "GET", "/automation/overdue-loans");
    expect((await res.json()).count).toBe(0);
  });

  test("a key can't be written under the other kind", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const res = await signedFetch(
      t,
      "POST",
      "/automation/events",
      writeBack(loanId, `overdue:${loanId}:${todayIso()}`, "sent", "request_notification"),
    );
    expect(res.status).toBe(400);
  });

  test("a valid signature for another endpoint is rejected", async () => {
    const t = setup();
    const { timestamp, signature } = await signRequest(SECRET, "GET", "/automation/overdue-loans", "");
    const res = await t.fetch("/automation/events", {
      method: "POST",
      headers: { "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature },
      body: "",
    });
    expect(res.status).toBe(401);
  });
});

describe("outbox delivery", () => {
  test("retries with backoff, then marks the event failed", async () => {
    const t = setup();
    await overdueLoan(t);
    // No webhook URL is configured here, so every attempt fails.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const outbox = await t.run(async (ctx) => ctx.db.query("outbox").take(10));
    expect(outbox.every((e) => e.status === "failed" && e.attempts === 6)).toBe(true);
    expect(outbox[0].lastError).toMatch(/not set/);
  });

  test("an event whose data is gone fails at once instead of staying pending", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);
    await bob.client.mutation(api.loans.request, { toolId, startDate: tomorrow(), endDate: tomorrow() });
    await t.run(async (ctx) => ctx.db.delete("users", alice.id));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [event] = await t.run(async (ctx) => ctx.db.query("outbox").take(1));
    expect(event).toMatchObject({ status: "failed", attempts: 1 });
    expect(event.lastError).toMatch(/no longer exists/);
  });

  test("the sweep re-schedules a delivery whose attempt never ran", async () => {
    const t = setup();
    await overdueLoan(t);
    const [event] = await t.run(async (ctx) => ctx.db.query("outbox").take(1));
    expect(await t.mutation(internal.notifications.sweepStuck, {})).toBe(0);
    await t.run(async (ctx) =>
      ctx.db.patch("outbox", event._id, { nextAttemptAt: Date.now() - 10 * 60_000 }),
    );
    expect(await t.mutation(internal.notifications.sweepStuck, {})).toBe(1);
  });

  test("the payload carries first names, the tool name and dates, nothing else", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const [requested] = await t.run(async (ctx) => ctx.db.query("outbox").take(1));
    const result = await t.query(internal.notifications.payloadFor, { outboxId: requested._id });
    expect(result).toEqual({
      kind: "ready",
      payload: {
        eventId: requested._id,
        type: "loan.requested",
        occurredAt: expect.any(String),
        recipient: { firstName: "Alice", email: "alice@example.test" },
        counterpartyFirstName: "Bob",
        tool: { name: "Cordless drill" },
        loan: { id: loanId, startDate: expect.any(String), endDate: expect.any(String) },
      },
    });
  });
});

/** The outbox row a loan event is recorded on. */
async function notification(t: ReturnType<typeof setup>, type: Doc<"outbox">["type"]) {
  const rows = await t.run(async (ctx) => ctx.db.query("outbox").take(20));
  return rows.find((row) => row.type === type)!;
}

function notifyWriteBack(loanId: string, eventId: string, status: "sent" | "failed") {
  return writeBack(loanId, `notify:${eventId}`, status, "request_notification");
}

describe("notification results are recorded on the notification", () => {
  test("idempotently, with a later success replacing a failure", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const approved = await notification(t, "loan.approved");
    const post = async (status: "sent" | "failed") =>
      (await signedFetch(t, "POST", "/automation/events", notifyWriteBack(loanId, approved._id, status))).json();

    expect(await post("failed")).toEqual({ ok: true, result: "created" });
    expect(await post("failed")).toEqual({ ok: true, result: "duplicate" });
    expect(await post("sent")).toEqual({ ok: true, result: "updated" });
    expect(await post("sent")).toEqual({ ok: true, result: "duplicate" });
    expect((await t.run(async (ctx) => ctx.db.get("outbox", approved._id)))?.status).toBe("sent");
  });

  test("a result naming another loan is refused", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const other = await t.run(async (ctx) =>
      ctx.db.insert("loans", {
        toolId: (await ctx.db.get("loans", loanId))!.toolId,
        ownerId: (await ctx.db.get("loans", loanId))!.ownerId,
        borrowerId: (await ctx.db.get("loans", loanId))!.borrowerId,
        startDate: todayIso(),
        endDate: todayIso(),
        status: "declined",
      }),
    );
    const approved = await notification(t, "loan.approved");
    const res = await signedFetch(t, "POST", "/automation/events", notifyWriteBack(other, approved._id, "sent"));
    expect(res.status).toBe(404);
  });
});

describe("notifications n8n accepted but never reported on", () => {
  const LONG_AGO = () => Date.now() - CONFIRM_WITHIN_MS - 60_000;

  test("are flagged for admins, while reported ones are not", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const requested = await notification(t, "loan.requested");
    const approved = await notification(t, "loan.approved");
    // Both reached n8n a while ago; only the approval was reported back.
    await t.run(async (ctx) => {
      for (const id of [requested._id, approved._id]) {
        await ctx.db.patch("outbox", id, { status: "delivered", deliveredAt: LONG_AGO() });
      }
    });
    await signedFetch(t, "POST", "/automation/events", notifyWriteBack(loanId, approved._id, "sent"));

    expect(await t.mutation(internal.notifications.flagUnconfirmed, {})).toBe(1);
    const rows = await t.run(async (ctx) =>
      Promise.all([ctx.db.get("outbox", requested._id), ctx.db.get("outbox", approved._id)]),
    );
    expect(rows.map((r) => r?.status)).toEqual(["unconfirmed", "sent"]);
  });

  test("a result that beats the delivery bookkeeping still counts", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const event = await notification(t, "loan.requested");
    // n8n reports back while Convex still has the row as pending...
    await signedFetch(t, "POST", "/automation/events", notifyWriteBack(loanId, event._id, "sent"));
    // ...and only then gets to record the 202, which must not undo it.
    await t.mutation(internal.notifications.recordAttempt, { outboxId: event._id, ok: true });
    await t.mutation(internal.notifications.flagUnconfirmed, {});
    expect((await t.run(async (ctx) => ctx.db.get("outbox", event._id)))?.status).toBe("sent");
  });
});

describe("admins re-send notifications that failed or got no result", () => {
  test("only an admin can, and it goes out as a new event", async () => {
    const t = setup();
    const { loanId, alice } = await overdueLoan(t);
    const admin = await signIn(t, "Ada", { admin: true });
    // The approval notice still matches the (approved) loan, so it may be re-sent.
    const approved = await notification(t, "loan.approved");
    await signedFetch(t, "POST", "/automation/events", notifyWriteBack(loanId, approved._id, "failed"));
    const before = await admin.client.query(api.admin.automationHealth, { today: todayIso() });
    expect(before.notifications).toMatchObject([{ id: approved._id, status: "failed", loanStatus: "approved" }]);

    await expect(
      alice.client.mutation(api.admin.resendNotification, { outboxId: approved._id }),
    ).rejects.toThrow(/Only admins/);
    expect(await admin.client.mutation(api.admin.resendNotification, { outboxId: approved._id })).toEqual({
      sent: true,
    });

    const outbox = await t.run(async (ctx) => ctx.db.query("outbox").take(10));
    expect(outbox.find((e) => e._id === approved._id)?.status).toBe("resent");
    expect(outbox.at(-1)).toMatchObject({ type: "loan.approved", recipientId: approved.recipientId, status: "pending" });
    expect((await admin.client.query(api.admin.automationHealth, { today: todayIso() })).notifications).toHaveLength(0);
  });

  test("an unconfirmed one too", async () => {
    const t = setup();
    await overdueLoan(t);
    const admin = await signIn(t, "Ada", { admin: true });
    const approved = await notification(t, "loan.approved");
    await t.run(async (ctx) =>
      ctx.db.patch("outbox", approved._id, {
        status: "delivered",
        deliveredAt: Date.now() - CONFIRM_WITHIN_MS - 60_000,
      }),
    );
    await t.mutation(internal.notifications.flagUnconfirmed, {});
    const health = await admin.client.query(api.admin.automationHealth, { today: todayIso() });
    expect(health.notifications).toMatchObject([{ id: approved._id, status: "unconfirmed" }]);
    expect(await admin.client.mutation(api.admin.resendNotification, { outboxId: approved._id })).toEqual({
      sent: true,
    });
  });

  test("but never an out-of-date notice", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const admin = await signIn(t, "Ada", { admin: true });
    const toolId = await listDrill(alice.client);
    const loanId = await bob.client.mutation(api.loans.request, {
      toolId,
      startDate: tomorrow(),
      endDate: inDays(2),
    });
    const requested = await notification(t, "loan.requested");
    await signedFetch(t, "POST", "/automation/events", notifyWriteBack(loanId, requested._id, "failed"));
    await bob.client.mutation(api.loans.cancel, { loanId });

    // "Bob wants to borrow your drill" would ask Alice to act on nothing.
    const result = await admin.client.mutation(api.admin.resendNotification, { outboxId: requested._id });
    expect(result).toEqual({ sent: false, reason: "the loan is now cancelled" });
    const outbox = await t.run(async (ctx) => ctx.db.query("outbox").take(10));
    expect(outbox.find((e) => e._id === requested._id)?.status).toBe("dismissed");
    expect(outbox.filter((e) => e.type === "loan.requested")).toHaveLength(1);
    expect((await admin.client.query(api.admin.automationHealth, { today: todayIso() })).notifications).toHaveLength(0);
  });

  test("failed reminders are listed, and retried by the next daily run", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const admin = await signIn(t, "Ada", { admin: true });
    await signedFetch(t, "POST", "/automation/events", writeBack(loanId, `overdue:${loanId}:${todayIso()}`, "failed"));
    const health = await admin.client.query(api.admin.automationHealth, { today: todayIso() });
    expect(health.reminders).toMatchObject([{ error: "SMTP down" }]);
    // A failed reminder doesn't count as sent, so the loan is still offered.
    const res = await signedFetch(t, "GET", "/automation/overdue-loans");
    expect((await res.json()).count).toBe(1);
  });
});

describe("loan activity", () => {
  test("says which email each result was about", async () => {
    const t = setup();
    const { loanId, bob } = await overdueLoan(t);
    for (const type of ["loan.requested", "loan.approved"] as const) {
      const event = await notification(t, type);
      await signedFetch(t, "POST", "/automation/events", notifyWriteBack(loanId, event._id, "sent"));
    }
    await signedFetch(t, "POST", "/automation/events", writeBack(loanId, `overdue:${loanId}:${todayIso()}`, "sent"));

    const items = await t.run(async (ctx) => loanActivity(ctx, loanId, 10));
    expect(items).toHaveLength(3);
    expect(items).toContainEqual(expect.objectContaining({ kind: "notification", type: "loan.approved", status: "sent" }));
    expect(items).toContainEqual(expect.objectContaining({ kind: "notification", type: "loan.requested", status: "sent" }));
    expect(items).toContainEqual(expect.objectContaining({ kind: "reminder", status: "sent" }));
    const [loan] = await bob.client.query(api.loans.myRequests, { today: todayIso() });
    expect(loan.activity).toHaveLength(3);
  });
});

describe("reminder results must belong to a real overdue day", () => {
  test("a reminder for a loan that isn't overdue, or for another day, is refused", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const bob = await signIn(t, "Bob");
    const toolId = await listDrill(alice.client);
    const requested = await bob.client.mutation(api.loans.request, { toolId, startDate: tomorrow(), endDate: inDays(2) });
    const notOverdue = await signedFetch(
      t,
      "POST",
      "/automation/events",
      writeBack(requested, `overdue:${requested}:${todayIso()}`, "sent"),
    );
    expect(notOverdue.status).toBe(404);

    const { loanId } = await overdueLoan(t);
    for (const day of [addDays(todayIso(), 1), addDays(todayIso(), -5), "someday"]) {
      const res = await signedFetch(t, "POST", "/automation/events", writeBack(loanId, `overdue:${loanId}:${day}`, "sent"));
      expect(res.status).not.toBe(200);
    }
    expect(await t.run(async (ctx) => ctx.db.query("reminders").take(10))).toHaveLength(0);
  });

  test("a result can't be dated in the future", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const body = JSON.stringify({
      ...JSON.parse(writeBack(loanId, `overdue:${loanId}:${todayIso()}`, "sent")),
      occurredAt: "2099-01-01T00:00:00.000Z",
    });
    await signedFetch(t, "POST", "/automation/events", body);
    const [row] = await t.run(async (ctx) => ctx.db.query("reminders").take(1));
    expect(row.occurredAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("delivery to n8n", () => {
  beforeEach(() => {
    vi.stubEnv("N8N_LOAN_EVENTS_WEBHOOK_URL", "http://n8n.test/webhook/lendloop-loan-events");
    vi.stubEnv("LENDLOOP_TO_N8N_SECRET", "test-secret-convex-to-n8n");
  });
  afterEach(() => vi.unstubAllGlobals());

  test("each event is posted once, signed, and marked delivered on a 202", async () => {
    // n8n's side: accept only a valid signature.
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const verdict = await verifySignature("test-secret-convex-to-n8n", {
        method: "POST",
        path: "/webhook/lendloop-loan-events",
        body: String(init.body),
        timestamp: headers["x-lendloop-timestamp"],
        signature: headers["x-lendloop-signature"],
      });
      return new Response(null, { status: verdict.ok ? 202 : 401 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const t = setup();
    await overdueLoan(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const outbox = await t.run(async (ctx) => ctx.db.query("outbox").take(10));
    expect(outbox.map((e) => e.status)).toEqual(["delivered", "delivered"]);
    const posted = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).eventId);
    expect(posted.sort()).toEqual(outbox.map((e) => e._id).sort());
  });

  test("an error response is retried with backoff, then marked failed with the reason", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response("boom", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const t = setup();
    await overdueLoan(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const outbox = await t.run(async (ctx) => ctx.db.query("outbox").take(10));
    for (const event of outbox) {
      expect(event).toMatchObject({ status: "failed", attempts: 6, lastError: "n8n responded with HTTP 500" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(outbox.length * 6);
  });

  test("a delivery that keeps getting lost ends as failed instead of looping", async () => {
    const t = setup();
    await overdueLoan(t);
    const [event] = await t.run(async (ctx) => ctx.db.query("outbox").take(1));
    for (let i = 0; i < 10; i++) {
      await t.run(async (ctx) => ctx.db.patch("outbox", event._id, { nextAttemptAt: Date.now() - 10 * 60_000 }));
      await t.mutation(internal.notifications.sweepStuck, {});
    }
    expect(await t.run(async (ctx) => ctx.db.get("outbox", event._id))).toMatchObject({ status: "failed" });
  });
});
