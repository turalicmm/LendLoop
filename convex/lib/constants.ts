import { v, type VLiteral } from "convex/values";

// Shared between Convex functions and the Next.js UI. Keep this file free of
// server-only imports so the frontend can import it too.

/**
 * A validator that accepts exactly the strings in `values`. Each enum below is
 * written once, as an array; its type and its validator both come from it.
 */
function literals<const T extends readonly [string, string, ...string[]]>(values: T) {
  type Literal = VLiteral<T[number]>;
  return v.union(...(values.map((value) => v.literal(value)) as [Literal, Literal, ...Literal[]]));
}

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const categoryValidator = literals(CATEGORIES);

export const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
};

export const CONDITIONS = ["like_new", "good", "fair", "worn"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const conditionValidator = literals(CONDITIONS);

export const CONDITION_LABELS: Record<Condition, string> = {
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  worn: "Well used",
};

export const ROLES = ["user", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const roleValidator = literals(ROLES);

export const LOAN_STATUSES = ["requested", "approved", "declined", "cancelled", "returned"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const loanStatusValidator = literals(LOAN_STATUSES);

// Events sent to n8n. Each one has exactly one recipient.
export const LOAN_EVENT_TYPES = [
  "loan.requested", // -> lender
  "loan.approved", // -> borrower
  "loan.declined", // -> borrower
  "loan.cancelled", // -> lender (borrower withdrew)
  "loan.listing_removed", // -> borrower (request or booking closed by removal)
  "loan.returned", // -> borrower (lender confirmed the return)
  "loan.expired", // -> borrower (the lender didn't answer before the start date)
] as const;
export type LoanEventType = (typeof LOAN_EVENT_TYPES)[number];
export const loanEventTypeValidator = literals(LOAN_EVENT_TYPES);

/** The loan status each notice describes; a notice is out of date once the loan has left it. */
export const STATUS_FOR_EVENT: Record<LoanEventType, LoanStatus> = {
  "loan.requested": "requested",
  "loan.approved": "approved",
  "loan.declined": "declined",
  "loan.cancelled": "cancelled",
  "loan.listing_removed": "cancelled",
  "loan.returned": "returned",
  "loan.expired": "declined",
};

/**
 * One notification's whole life, on its outbox row:
 *   pending     waiting to be delivered to n8n (retried with backoff)
 *   delivered   n8n accepted it; its result hasn't come back yet
 *   sent        n8n reported the email went out
 *   failed      n8n never accepted it, or reported that the email failed
 *   unconfirmed delivered, but no result came back in time
 *   resent      an admin sent it again as a new event
 *   dismissed   an admin's re-send was refused because the notice was out of date
 */
export const NOTIFICATION_STATUSES = [
  "pending",
  "delivered",
  "sent",
  "failed",
  "unconfirmed",
  "resent",
  "dismissed",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export const notificationStatusValidator = literals(NOTIFICATION_STATUSES);

/** What n8n reports back for an email, a notification's or a reminder's. */
export const DELIVERY_RESULTS = ["sent", "failed"] as const;
export type DeliveryResult = (typeof DELIVERY_RESULTS)[number];
export const deliveryResultValidator = literals(DELIVERY_RESULTS);

/**
 * The two kinds of write-back n8n sends to POST /automation/events, and the
 * prefix each one's idempotency key must carry.
 */
export const WRITE_BACK_KEY_PREFIX = {
  request_notification: "notify:",
  overdue_reminder: "overdue:",
} as const;
export type WriteBackKind = keyof typeof WRITE_BACK_KEY_PREFIX;

export const LIMITS = {
  toolName: 80,
  toolDescription: 500,
  requestMessage: 300,
  maxLoanDays: 30,
  maxDaysAhead: 90,
  // Every request or cancellation emails a lender, so borrowing is throttled.
  maxRequestsPerHour: 10,
  maxOpenRequestsPerTool: 2,
  // One account can't flood the shared catalogue.
  maxListingsPerUser: 50,
  maxListingsPerHour: 20,
} as const;
