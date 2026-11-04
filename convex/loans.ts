import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { can, getViewer, requireViewer, type Viewer } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { fail } from "./lib/errors";
import { hourlyLimitReached } from "./lib/limits";
import {
  isApprovable,
  isCancellable,
  isOverdue,
  isReturnable,
  loanActivity,
  loansForTool,
  occupiedRange,
  rangesOverlap,
} from "./lib/loans";
import { enqueueLoanEvent } from "./lib/outbox";
import { loadLiveTool } from "./lib/tools";
import { firstName, optionalText, requireIsoDate, todayIso, validateLoanRange } from "./lib/validation";

const LIST_LIMIT = 100;
const EXPIRE_BATCH = 100;

async function loadLoan(ctx: QueryCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get("loans", loanId);
  if (!loan) fail("NOT_FOUND", "Request not found.");
  return loan;
}

type Range = { startDate: string; endDate: string };

/**
 * Each request (and each cancellation) emails a lender, so a borrower gets a
 * fixed number of requests per hour and of open requests per tool, and can't
 * ask twice for the same days. Counting real rows inside the mutation is
 * exact: mutations are serializable, and a refused request leaves no row
 * behind to burn quota.
 */
async function enforceRequestLimits(ctx: MutationCtx, viewer: Viewer, toolId: Id<"tools">, range: Range) {
  const recent = await ctx.db
    .query("loans")
    .withIndex("by_borrowerId", (q) => q.eq("borrowerId", viewer._id))
    .order("desc")
    .take(LIMITS.maxRequestsPerHour);
  if (hourlyLimitReached(recent, LIMITS.maxRequestsPerHour)) {
    fail("RATE_LIMITED", "You've sent a lot of requests in the last hour. Please try again later.");
  }

  const myOpen = await ctx.db
    .query("loans")
    .withIndex("by_borrowerId_and_toolId_and_status", (q) =>
      q.eq("borrowerId", viewer._id).eq("toolId", toolId).eq("status", "requested"),
    )
    .take(LIMITS.maxOpenRequestsPerTool + 1);
  if (myOpen.some((loan) => rangesOverlap(loan, range))) {
    fail("CONFLICT", "You already have an open request for those days.");
  }
  if (myOpen.length >= LIMITS.maxOpenRequestsPerTool) {
    fail("CONFLICT", "You already have open requests for this tool. Wait for a reply first.");
  }
}

/** Ask to borrow someone else's tool for an inclusive date range. */
export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const tool = await loadLiveTool(ctx, args.toolId);
    if (!can.borrowTool(viewer, tool)) fail("FORBIDDEN", "You can't borrow your own tool.");

    const today = todayIso();
    const range = { startDate: args.startDate, endDate: args.endDate };
    validateLoanRange(range.startDate, range.endDate, today);
    await enforceRequestLimits(ctx, viewer, tool._id, range);
    await refuseClash(ctx, tool._id, range, today, "The tool is already booked for some of those days.");

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      ...range,
      message: optionalText(args.message, "Message", LIMITS.requestMessage),
      status: "requested",
    });
    await enqueueLoanEvent(ctx, { type: "loan.requested", loanId, recipientId: tool.ownerId });
    return loanId;
  },
});

/** Refuses a range that clashes with an approved loan, including one still out past its end date. */
async function refuseClash(ctx: QueryCtx, toolId: Id<"tools">, range: Range, today: string, bookedMessage: string) {
  const approved = await loansForTool(ctx, toolId, "approved");
  const clash = approved.find((loan) => rangesOverlap(occupiedRange(loan, today), range));
  if (!clash) return;
  fail(
    "CONFLICT",
    isOverdue(clash, today) ? "This tool hasn't come back from its last loan yet." : bookedMessage,
  );
}

/** Loads a request the viewer, as its lender, is about to decide on. */
async function loadOpenRequestForLender(ctx: QueryCtx, viewer: Viewer, loanId: Id<"loans">, action: string) {
  const loan = await loadLoan(ctx, loanId);
  if (!can.decideRequest(viewer, loan)) fail("FORBIDDEN", `Only the lender can ${action} this request.`);
  if (loan.status !== "requested") fail("CONFLICT", "This request has already been handled.");
  return loan;
}

/**
 * Lender approves a request. Other open requests that overlap the approved
 * days can no longer be met, so they are declined in the same transaction.
 */
export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadOpenRequestForLender(ctx, viewer, loanId, "approve");
    const today = todayIso();
    if (!isApprovable(loan, today)) fail("CONFLICT", "The requested start date has passed.");
    const tool = await ctx.db.get("tools", loan.toolId);
    if (!tool || tool.removedAt !== undefined) fail("CONFLICT", "This listing has been removed.");
    await refuseClash(ctx, loan.toolId, loan, today, "You already approved another loan for some of those days.");

    const now = Date.now();
    await ctx.db.patch("loans", loanId, { status: "approved", decidedAt: now });
    await enqueueLoanEvent(ctx, { type: "loan.approved", loanId, recipientId: loan.borrowerId });

    const pending = await loansForTool(ctx, loan.toolId, "requested");
    for (const other of pending) {
      if (other._id === loanId || !rangesOverlap(other, loan)) continue;
      await ctx.db.patch("loans", other._id, { status: "declined", decidedAt: now });
      await enqueueLoanEvent(ctx, { type: "loan.declined", loanId: other._id, recipientId: other.borrowerId });
    }
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadOpenRequestForLender(ctx, viewer, loanId, "decline");
    await ctx.db.patch("loans", loanId, { status: "declined", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, { type: "loan.declined", loanId, recipientId: loan.borrowerId });
  },
});

/** Borrower withdraws a request, or an approved loan that hasn't started. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    if (!can.cancelRequest(viewer, loan)) fail("FORBIDDEN", "Only the borrower can cancel this request.");
    if (!isCancellable(loan, todayIso())) fail("CONFLICT", "This request can no longer be cancelled.");
    await ctx.db.patch("loans", loanId, { status: "cancelled", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, { type: "loan.cancelled", loanId, recipientId: loan.ownerId });
  },
});

/** The lender confirms the tool is back. That ends the loan and any reminders. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    if (!can.markReturned(viewer, loan)) fail("FORBIDDEN", "Only the lender can mark a loan as returned.");
    if (!isReturnable(loan, todayIso())) {
      fail(
        "CONFLICT",
        loan.status === "approved"
          ? "This loan hasn't started yet, so there is nothing to return."
          : "Only an active loan can be marked as returned.",
      );
    }
    await ctx.db.patch("loans", loanId, { status: "returned", returnedAt: Date.now() });
    await enqueueLoanEvent(ctx, { type: "loan.returned", loanId, recipientId: loan.borrowerId });
  },
});

/**
 * One loan as one of its two people sees it. Only the borrower and the lender
 * ever get a row (see `myRequests` and `incoming`), which is what makes the
 * message and, while the loan is approved, the other person's email theirs to see.
 */
async function loanRow(ctx: QueryCtx, loan: Doc<"loans">, viewer: Viewer, today: string) {
  const viewerIsLender = loan.ownerId === viewer._id;
  if (!viewerIsLender && loan.borrowerId !== viewer._id) {
    throw new Error("loanRow is only for the loan's borrower and lender");
  }
  const [tool, counterparty, activity] = await Promise.all([
    ctx.db.get("tools", loan.toolId),
    ctx.db.get("users", viewerIsLender ? loan.borrowerId : loan.ownerId),
    loanActivity(ctx, loan._id),
  ]);
  return {
    id: loan._id,
    tool: {
      id: loan.toolId,
      name: tool?.name ?? "Removed listing",
      category: tool?.category ?? "other",
      removed: tool?.removedAt !== undefined,
    },
    counterparty: {
      firstName: counterparty ? firstName(counterparty.name) : "Neighbour",
      trusted: counterparty?.trustedLender ?? false,
      // So they can arrange the handover; never before approval.
      email: loan.status === "approved" ? counterparty?.email : undefined,
    },
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: isOverdue(loan, today),
    message: loan.message,
    requestedAt: loan._creationTime,
    decidedAt: loan.decidedAt,
    returnedAt: loan.returnedAt,
    activity,
    canApprove: viewerIsLender && isApprovable(loan, today),
    canDecline: viewerIsLender && loan.status === "requested",
    canCancel: !viewerIsLender && isCancellable(loan, today),
    canMarkReturned: viewerIsLender && isReturnable(loan, today),
  };
}

/** The viewer's loans on one side, newest first, as rows. */
async function viewerLoans(ctx: QueryCtx, today: string, side: "borrower" | "lender") {
  requireIsoDate(today);
  const viewer = await getViewer(ctx);
  if (!viewer) return [];
  const loans = ctx.db.query("loans");
  const mine =
    side === "borrower"
      ? loans.withIndex("by_borrowerId", (q) => q.eq("borrowerId", viewer._id))
      : loans.withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id));
  const rows = await mine.order("desc").take(LIST_LIMIT);
  return await Promise.all(rows.map((loan) => loanRow(ctx, loan, viewer, today)));
}

/** Requests the viewer made as a borrower. */
export const myRequests = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => await viewerLoans(ctx, today, "borrower"),
});

/** Requests and loans on the viewer's own tools. */
export const incoming = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => await viewerLoans(ctx, today, "lender"),
});

/**
 * Runs from crons.ts. A request the lender never answered can't be approved
 * once its first day has passed, so it is closed and the borrower told,
 * instead of sitting in both people's lists (and the borrower's request
 * limits) forever.
 */
export const expireUnanswered = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("loans")
      .withIndex("by_status_and_startDate", (q) => q.eq("status", "requested").lt("startDate", todayIso()))
      .take(EXPIRE_BATCH);
    for (const loan of stale) {
      await ctx.db.patch("loans", loan._id, { status: "declined", decidedAt: Date.now() });
      await enqueueLoanEvent(ctx, { type: "loan.expired", loanId: loan._id, recipientId: loan.borrowerId });
    }
    return stale.length;
  },
});
