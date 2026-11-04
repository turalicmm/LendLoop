import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { DeliveryResult, LoanEventType, NotificationStatus } from "./constants";

// Upper bounds for per-tool and per-loan reads. Approved loans of one tool
// can't overlap, bookings reach at most LIMITS.maxDaysAhead days out, and an
// overdue loan blocks new ones, so a tool holds fewer approved loans than
// this; the cap is a safety net, not a page size.
const LOANS_PER_TOOL = 200;
const ACTIVITY_PER_LOAN = 50;

export async function loansForTool(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  status: Doc<"loans">["status"],
) {
  return await ctx.db
    .query("loans")
    .withIndex("by_toolId_and_status", (q) => q.eq("toolId", toolId).eq("status", status))
    .take(LOANS_PER_TOOL);
}

type Dated = Pick<Doc<"loans">, "status" | "startDate" | "endDate">;

// The loan state machine's date rules, in one place: the mutations enforce
// them and the views offer the matching buttons.

/** Approved, and its last day has passed. */
export function isOverdue(loan: Dated, today: string): boolean {
  return loan.status === "approved" && loan.endDate < today;
}

/** The lender can still approve: a request whose first day hasn't passed. */
export function isApprovable(loan: Dated, today: string): boolean {
  return loan.status === "requested" && loan.startDate >= today;
}

/** The borrower can still withdraw: a request, or a booking that hasn't started. */
export function isCancellable(loan: Dated, today: string): boolean {
  return loan.status === "requested" || (loan.status === "approved" && loan.startDate > today);
}

/** The lender can confirm the return once the loan has started. */
export function isReturnable(loan: Dated, today: string): boolean {
  return loan.status === "approved" && loan.startDate <= today;
}

/**
 * The days an approved loan keeps the tool. An overdue loan hasn't come
 * back, so it holds the tool until the lender marks it returned: nobody can
 * book days the tool may not be home for.
 */
export function occupiedRange(loan: Dated, today: string) {
  return { startDate: loan.startDate, endDate: isOverdue(loan, today) ? "9999-12-31" : loan.endDate };
}

/** Inclusive date ranges overlap when each starts before the other ends. */
export function rangesOverlap(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export type ActivityItem =
  | {
      kind: "notification";
      type: LoanEventType;
      // "delivered" is in flight, with nothing to report yet.
      status: Exclude<NotificationStatus, "delivered">;
      at: number;
    }
  | { kind: "reminder"; status: DeliveryResult; at: number };

/** Recent automation on one loan, newest first: its notifications and reminders. */
export async function loanActivity(
  ctx: QueryCtx,
  loanId: Id<"loans">,
  limit = 3,
): Promise<ActivityItem[]> {
  const [notifications, reminders] = await Promise.all([
    ctx.db
      .query("outbox")
      .withIndex("by_loanId", (q) => q.eq("loanId", loanId))
      .order("desc")
      .take(ACTIVITY_PER_LOAN),
    ctx.db
      .query("reminders")
      .withIndex("by_loanId", (q) => q.eq("loanId", loanId))
      .order("desc")
      .take(ACTIVITY_PER_LOAN),
  ]);
  const items: ActivityItem[] = [];
  for (const n of notifications) {
    if (n.status === "delivered") continue;
    items.push({ kind: "notification", type: n.type, status: n.status, at: n.resultAt ?? n._creationTime });
  }
  for (const r of reminders) {
    items.push({ kind: "reminder", status: r.status, at: r.occurredAt });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}
