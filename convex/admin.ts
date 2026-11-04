import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { roleValidator, STATUS_FOR_EVENT } from "./lib/constants";
import { fail } from "./lib/errors";
import { isOverdue, loanActivity } from "./lib/loans";
import { enqueueLoanEvent } from "./lib/outbox";
import { addDays, firstName, requireIsoDate } from "./lib/validation";

const LOANS_LIMIT = 200;
const MEMBERS_LIMIT = 500;
const LISTING_COUNT_CAP = 100;
const PENDING_COUNT_CAP = 100;
const HEALTH_ITEMS = 20;

/** Every loan, newest first. Admin only. */
export const allLoans = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    requireIsoDate(today);
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(LOANS_LIMIT);
    return await Promise.all(
      loans.map(async (loan) => {
        const [tool, owner, borrower, activity] = await Promise.all([
          ctx.db.get("tools", loan.toolId),
          ctx.db.get("users", loan.ownerId),
          ctx.db.get("users", loan.borrowerId),
          loanActivity(ctx, loan._id),
        ]);
        return {
          id: loan._id,
          toolName: tool?.name ?? "Removed listing",
          lender: owner ? firstName(owner.name) : "Unknown",
          borrower: borrower ? firstName(borrower.name) : "Unknown",
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
          overdue: isOverdue(loan, today),
          activity,
        };
      }),
    );
  },
});

/** Members and their live listing counts, for the Trusted Lender toggle. */
export const members = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(MEMBERS_LIMIT);
    return await Promise.all(
      users.map(async (user) => {
        const listings = await ctx.db
          .query("tools")
          .withIndex("by_ownerId_and_removedAt", (q) => q.eq("ownerId", user._id).eq("removedAt", undefined))
          .take(LISTING_COUNT_CAP + 1);
        return {
          id: user._id,
          name: user.name,
          email: user.email ?? null,
          role: user.role,
          trustedLender: user.trustedLender,
          listings: Math.min(listings.length, LISTING_COUNT_CAP),
          listingsCapped: listings.length > LISTING_COUNT_CAP,
        };
      }),
    );
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get("users", userId))) fail("NOT_FOUND", "Member not found.");
    await ctx.db.patch("users", userId, { trustedLender: trusted });
  },
});

/** The tool and current state of a loan, so a row in the health panel says what it was about. */
async function loanSummary(ctx: QueryCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get("loans", loanId);
  const tool = loan ? await ctx.db.get("tools", loan.toolId) : null;
  return { toolName: tool?.name ?? "a deleted loan", loanStatus: loan?.status ?? null };
}

/**
 * What needs an admin's eye, so nothing fails silently:
 * - notifications that failed or never got a result (each can be re-sent);
 * - notifications still being retried after a failed delivery;
 * - overdue reminders that failed since yesterday (the next daily run tries
 *   again, so older ones have been superseded);
 * - how many notifications are still queued.
 */
export const automationHealth = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    requireIsoDate(today);
    await requireAdmin(ctx);
    const outboxWith = (status: Doc<"outbox">["status"]) =>
      ctx.db
        .query("outbox")
        .withIndex("by_status_and_nextAttemptAt", (q) => q.eq("status", status))
        .order("desc")
        .take(HEALTH_ITEMS);
    const since = Date.parse(`${addDays(today, -1)}T00:00:00Z`);
    const [failed, unconfirmed, pending, failedReminders] = await Promise.all([
      outboxWith("failed"),
      outboxWith("unconfirmed"),
      ctx.db
        .query("outbox")
        .withIndex("by_status_and_nextAttemptAt", (q) => q.eq("status", "pending"))
        .take(PENDING_COUNT_CAP + 1),
      ctx.db
        .query("reminders")
        .withIndex("by_status_and_occurredAt", (q) => q.eq("status", "failed").gte("occurredAt", since))
        .order("desc")
        .take(HEALTH_ITEMS),
    ]);
    return {
      pendingNotifications: Math.min(pending.length, PENDING_COUNT_CAP),
      pendingCapped: pending.length > PENDING_COUNT_CAP,
      // Queued notifications whose delivery already failed at least once and
      // is waiting for its next retry (up to 6 h away), so they don't look fine.
      retrying: await Promise.all(
        pending
          .filter((n) => n.attempts > 0 && n.lastError)
          .slice(0, HEALTH_ITEMS)
          .map(async (n) => ({
            id: n._id,
            type: n.type,
            attempts: n.attempts,
            error: n.lastError ?? null,
            nextAttemptAt: n.nextAttemptAt,
            ...(await loanSummary(ctx, n.loanId)),
          })),
      ),
      notifications: (
        await Promise.all(
          [
            ...failed.map((n) => ({ n, status: "failed" as const })),
            ...unconfirmed.map((n) => ({ n, status: "unconfirmed" as const })),
          ].map(async ({ n, status }) => ({
            id: n._id,
            type: n.type,
            status,
            error: n.lastError ?? null,
            at: n.resultAt ?? n.deliveredAt ?? n._creationTime,
            ...(await loanSummary(ctx, n.loanId)),
          })),
        )
      ).sort((a, b) => b.at - a.at),
      reminders: await Promise.all(
        failedReminders.map(async (r) => ({
          id: r._id,
          error: r.detail ?? null,
          at: r.occurredAt,
          ...(await loanSummary(ctx, r.loanId)),
        })),
      ),
    };
  },
});

/**
 * Re-sends a notification that failed or never got a result, as a new event:
 * n8n drops repeats of an event id it has seen, so the old one could be
 * silently skipped. An unconfirmed email may in fact have gone out, which is
 * why re-sending is an admin's call and not automatic. If the loan has moved
 * on since (e.g. "Bob wants to borrow your drill" after Bob cancelled), the
 * notice would be out of date, so it is dismissed instead.
 */
export const resendNotification = mutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }): Promise<{ sent: true } | { sent: false; reason: string }> => {
    await requireAdmin(ctx);
    const event = await ctx.db.get("outbox", outboxId);
    if (!event || (event.status !== "failed" && event.status !== "unconfirmed")) {
      fail("CONFLICT", "Only a failed or unconfirmed notification can be re-sent.");
    }
    const loan = await ctx.db.get("loans", event.loanId);
    if (!loan || loan.status !== STATUS_FOR_EVENT[event.type]) {
      await ctx.db.patch("outbox", outboxId, { status: "dismissed" });
      return { sent: false, reason: loan ? `the loan is now ${loan.status}` : "the loan no longer exists" };
    }
    await enqueueLoanEvent(ctx, { type: event.type, loanId: event.loanId, recipientId: event.recipientId });
    await ctx.db.patch("outbox", outboxId, { status: "resent" });
    return { sent: true };
  },
});

/**
 * Grants or revokes the admin role. Internal on purpose: no client can call
 * it, only someone with deployment access:
 *   npx convex run admin:setRole '{"email":"you@example.com","role":"admin"}'
 * Every account with that email is updated (one person may have signed in
 * through more than one Clerk instance).
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, { email, role }) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(10);
    if (users.length === 0) throw new Error(`No user with email ${email}. Sign in once first.`);
    for (const user of users) await ctx.db.patch("users", user._id, { role });
    return { updated: users.map((u) => u._id), role };
  },
});
