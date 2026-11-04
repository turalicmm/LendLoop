import { v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { deliveryResultValidator } from "./lib/constants";
import { signRequest, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/signing";
import { firstName } from "./lib/validation";

// Delay before attempt 2, 3, ... After the last one the event is marked
// failed, which shows up in the admin "Automation health" panel.
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
// The first try plus one per delay. Both a failed attempt and a lost one count.
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;
// A scheduled attempt that hasn't recorded anything this long after it was
// due crashed or was lost; the sweep re-schedules it.
const STUCK_AFTER_MS = 5 * 60_000;
const SWEEP_BATCH = 50;
// n8n answers 202 before it sends the email, then writes the result back.
// A delivered event with no result after this long is flagged for admins.
export const CONFIRM_WITHIN_MS = 15 * 60_000;

/**
 * The webhook body for one outbox event. Only what the notification needs:
 * the recipient's first name and email, the other party's first name, the
 * tool name and the loan dates. No descriptions, messages or other contacts.
 */
export const payloadFor = internalQuery({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const event = await ctx.db.get("outbox", outboxId);
    if (!event || event.status !== "pending") return { kind: "skip" as const };
    const loan = await ctx.db.get("loans", event.loanId);
    if (!loan) return { kind: "unbuildable" as const, reason: "loan no longer exists" };
    const counterpartyId = event.recipientId === loan.ownerId ? loan.borrowerId : loan.ownerId;
    const [tool, recipient, counterparty] = await Promise.all([
      ctx.db.get("tools", loan.toolId),
      ctx.db.get("users", event.recipientId),
      ctx.db.get("users", counterpartyId),
    ]);
    if (!tool || !recipient) {
      return { kind: "unbuildable" as const, reason: "tool or recipient no longer exists" };
    }
    return {
      kind: "ready" as const,
      payload: {
        eventId: event._id,
        type: event.type,
        occurredAt: new Date(event._creationTime).toISOString(),
        recipient: { firstName: firstName(recipient.name), email: recipient.email ?? null },
        counterpartyFirstName: counterparty ? firstName(counterparty.name) : "A neighbour",
        tool: { name: tool.name },
        loan: { id: loan._id, startDate: loan.startDate, endDate: loan.endDate },
      },
    };
  },
});

/** Posts one signed event to the n8n webhook. Retries are scheduled by `recordAttempt`. */
export const deliver = internalAction({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const result = await ctx.runQuery(internal.notifications.payloadFor, { outboxId });
    if (result.kind === "skip") return;
    if (result.kind === "unbuildable") {
      // Retrying can't bring deleted data back, so fail now, visibly.
      await ctx.runMutation(internal.notifications.recordAttempt, {
        outboxId,
        ok: false,
        error: result.reason,
        final: true,
      });
      return;
    }

    const url = env.N8N_LOAN_EVENTS_WEBHOOK_URL;
    const secret = env.LENDLOOP_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.recordAttempt, {
        outboxId,
        ok: false,
        error: "N8N_LOAN_EVENTS_WEBHOOK_URL or LENDLOOP_TO_N8N_SECRET is not set",
      });
      return;
    }

    const body = JSON.stringify({ ...result.payload, appUrl: env.APP_URL ?? null });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const { timestamp, signature } = await signRequest(secret, "POST", new URL(url).pathname, body);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
          "x-lendloop-event-id": result.payload.eventId,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`n8n responded with HTTP ${response.status}`);
      await ctx.runMutation(internal.notifications.recordAttempt, { outboxId, ok: true });
    } catch (error) {
      await ctx.runMutation(internal.notifications.recordAttempt, {
        outboxId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  },
});

export const recordAttempt = internalMutation({
  args: {
    outboxId: v.id("outbox"),
    ok: v.boolean(),
    error: v.optional(v.string()),
    final: v.optional(v.boolean()),
  },
  handler: async (ctx, { outboxId, ok, error, final }) => {
    const event = await ctx.db.get("outbox", outboxId);
    if (!event || event.status !== "pending") return;
    const attempts = event.attempts + 1;
    if (ok) {
      await ctx.db.patch("outbox", outboxId, { status: "delivered", attempts, deliveredAt: Date.now() });
      return;
    }
    const lastError = (error ?? "unknown error").slice(0, 300);
    if (final || attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch("outbox", outboxId, { status: "failed", attempts, lastError });
      console.error(`Outbox ${outboxId} (${event.type}) failed after ${attempts} attempts: ${lastError}`);
      return;
    }
    const delay = RETRY_DELAYS_MS[attempts - 1];
    await ctx.db.patch("outbox", outboxId, {
      attempts,
      lastError,
      nextAttemptAt: Date.now() + delay,
    });
    console.warn(`Outbox ${outboxId} attempt ${attempts} failed, retrying in ${delay / 1000}s: ${lastError}`);
    await ctx.scheduler.runAfter(delay, internal.notifications.deliver, { outboxId });
  },
});

/**
 * Runs from crons.ts. Scheduled actions run at most once, so if one crashes
 * before it records a result, its row would stay pending forever. This finds
 * rows whose attempt is long overdue and schedules them again. A duplicate
 * delivery is harmless: n8n drops repeats by event id.
 */
export const sweepStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = await ctx.db
      .query("outbox")
      .withIndex("by_status_and_nextAttemptAt", (q) =>
        q.eq("status", "pending").lt("nextAttemptAt", now - STUCK_AFTER_MS),
      )
      .take(SWEEP_BATCH);
    for (const event of stuck) {
      // A lost attempt still counts, so a delivery that keeps crashing ends
      // as `failed` (and in the admin panel) instead of looping forever.
      const attempts = event.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await ctx.db.patch("outbox", event._id, {
          status: "failed",
          attempts,
          lastError: "delivery kept stopping before it could finish",
        });
        continue;
      }
      await ctx.db.patch("outbox", event._id, { attempts, nextAttemptAt: now });
      await ctx.scheduler.runAfter(0, internal.notifications.deliver, { outboxId: event._id });
    }
    if (stuck.length > 0) console.warn(`Re-scheduled ${stuck.length} stuck outbox deliveries`);
    return stuck.length;
  },
});

/**
 * n8n's report on one notification's email, written onto its outbox row.
 * Idempotent: the first result counts and repeats are no-ops, except that
 * "sent" replaces an earlier "failed" (a retry that worked). A result may
 * arrive before Convex has recorded n8n's 202, while the row is still
 * pending; it counts all the same, and the late bookkeeping leaves it alone.
 */
export const recordResult = internalMutation({
  args: {
    eventId: v.string(),
    loanId: v.string(),
    status: deliveryResultValidator,
    detail: v.optional(v.string()),
    occurredAt: v.number(),
  },
  handler: async (ctx, { eventId, loanId, status, detail, occurredAt }) => {
    const id = ctx.db.normalizeId("outbox", eventId);
    const event = id ? await ctx.db.get("outbox", id) : null;
    if (!event || event.loanId !== loanId) return "unknown" as const;

    const awaitingResult = ["pending", "delivered", "unconfirmed"].includes(event.status);
    const retryWorked = event.status === "failed" && status === "sent";
    if (!awaitingResult && !retryWorked) return "duplicate" as const;
    await ctx.db.patch("outbox", event._id, {
      status,
      resultAt: occurredAt,
      lastError: status === "failed" ? (detail ?? "sending failed").slice(0, 300) : undefined,
    });
    return awaitingResult ? ("created" as const) : ("updated" as const);
  },
});

/**
 * Runs from crons.ts. n8n acknowledges an event before it sends the email, so
 * an accepted event can still get lost (n8n crashed, or its write-back never
 * arrived). A row still `delivered` CONFIRM_WITHIN_MS later has had no
 * result, so it becomes `unconfirmed`, which puts it in the admin
 * "Automation health" panel with a Resend button.
 */
export const flagUnconfirmed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const silent = await ctx.db
      .query("outbox")
      .withIndex("by_status_and_deliveredAt", (q) =>
        q.eq("status", "delivered").gt("deliveredAt", 0).lt("deliveredAt", Date.now() - CONFIRM_WITHIN_MS),
      )
      .take(SWEEP_BATCH);
    for (const event of silent) {
      await ctx.db.patch("outbox", event._id, {
        status: "unconfirmed",
        lastError: "n8n accepted the event but never reported a result",
      });
    }
    if (silent.length > 0) console.error(`${silent.length} delivered notifications got no result from n8n`);
    return silent.length;
  },
});
