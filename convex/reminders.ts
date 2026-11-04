import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { deliveryResultValidator } from "./lib/constants";
import { addDays, daysBetween, firstName, isIsoDate, todayIso } from "./lib/validation";

// Reminders returned per run, and how many overdue loans one run may look at
// while skipping those already reminded today.
const OVERDUE_BATCH = 200;
const OVERDUE_SCAN_LIMIT = 2_000;

/** One reminder per loan per day: the idempotency key for its write-back. */
export function overdueReminderKey(loanId: string, today: string): string {
  return `overdue:${loanId}:${today}`;
}

/** The loan and day a reminder key names, or null if it isn't a well-formed key. */
function parseReminderKey(key: string): { loanId: string; day: string } | null {
  const match = key.match(/^overdue:([^:]+):(\d{4}-\d{2}-\d{2})$/);
  return match && isIsoDate(match[2]) ? { loanId: match[1], day: match[2] } : null;
}

/**
 * Approved loans whose end date has passed, minus the ones already reminded
 * today. Returns only what a reminder email needs. Scanning continues past
 * already-reminded loans, so a large backlog can't starve newer loans.
 */
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const result = [];
    let scanned = 0;
    for await (const loan of ctx.db
      .query("loans")
      .withIndex("by_status_and_endDate", (q) => q.eq("status", "approved").lt("endDate", today))) {
      if (++scanned > OVERDUE_SCAN_LIMIT || result.length >= OVERDUE_BATCH) break;
      const reminderKey = overdueReminderKey(loan._id, today);
      const already = await ctx.db
        .query("reminders")
        .withIndex("by_reminderKey", (q) => q.eq("reminderKey", reminderKey))
        .unique();
      if (already?.status === "sent") continue;

      const [borrower, tool] = await Promise.all([
        ctx.db.get("users", loan.borrowerId),
        ctx.db.get("tools", loan.toolId),
      ]);
      if (!borrower || !tool) continue;
      result.push({
        loanId: loan._id,
        reminderKey,
        borrower: { firstName: firstName(borrower.name), email: borrower.email ?? null },
        tool: { name: tool.name },
        dueDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return result;
  },
});

/**
 * Idempotent write-back of one reminder. The same key twice is a no-op,
 * except that a later "sent" replaces an earlier "failed" (a retry that
 * worked). The key must be today's or yesterday's key for a loan that was
 * overdue on that day; anything else is refused, so even a holder of the
 * signing secret can't pin made-up reminders onto unrelated loans.
 */
export const recordReminder = internalMutation({
  args: {
    reminderKey: v.string(),
    loanId: v.string(),
    status: deliveryResultValidator,
    detail: v.optional(v.string()),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const key = parseReminderKey(args.reminderKey);
    const today = todayIso();
    const isRecent = key !== null && key.day <= today && key.day >= addDays(today, -1);
    const loanId = key?.loanId === args.loanId ? ctx.db.normalizeId("loans", key.loanId) : null;
    if (!key || !isRecent || !loanId) return "unknown" as const;
    // Returned is allowed too: the lender may confirm the return between
    // n8n fetching the list and writing the result back.
    const loan = await ctx.db.get("loans", loanId);
    const wasOverdueThatDay = loan && (loan.status === "approved" || loan.status === "returned") && loan.endDate < key.day;
    if (!wasOverdueThatDay) return "unknown" as const;
    const fields = {
      loanId,
      status: args.status,
      detail: args.detail?.slice(0, 300),
      occurredAt: args.occurredAt,
    };
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_reminderKey", (q) => q.eq("reminderKey", args.reminderKey))
      .unique();
    if (!existing) {
      await ctx.db.insert("reminders", { reminderKey: args.reminderKey, ...fields });
      return "created" as const;
    }
    if (existing.status === "failed" && args.status === "sent") {
      await ctx.db.patch("reminders", existing._id, fields);
      return "updated" as const;
    }
    return "duplicate" as const;
  },
});
