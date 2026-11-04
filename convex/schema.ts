import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  categoryValidator,
  conditionValidator,
  deliveryResultValidator,
  loanEventTypeValidator,
  loanStatusValidator,
  notificationStatusValidator,
  roleValidator,
} from "./lib/constants";

export default defineSchema({
  // One row per Clerk user. Roles live here, not in the client, so the only
  // way to become an admin is the internal `admin:setRole` function.
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: roleValidator,
    trustedLender: v.boolean(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  // Listings are soft-deleted so loan history keeps pointing at a real row.
  // Catalogue queries read through `by_removedAt(_and_category)`, so removed
  // listings never take up room in a bounded page.
  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_removedAt", ["ownerId", "removedAt"])
    // Newest first across all categories, and within one.
    .index("by_removedAt", ["removedAt"])
    .index("by_removedAt_and_category", ["removedAt", "category"]),

  // A borrow request and, once approved, the loan itself. Dates are
  // inclusive UTC calendar days in YYYY-MM-DD form, so string order = time order.
  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_toolId_and_status", ["toolId", "status"])
    .index("by_borrowerId", ["borrowerId"])
    .index("by_borrowerId_and_toolId_and_status", ["borrowerId", "toolId", "status"])
    .index("by_ownerId", ["ownerId"])
    .index("by_status_and_endDate", ["status", "endDate"])
    .index("by_status_and_startDate", ["status", "startDate"]),

  // One row per loan notification: the transactional outbox entry and its
  // whole life after that (see NOTIFICATION_STATUSES). It is written in the
  // same mutation as the loan change, delivered to n8n by a scheduled action,
  // and n8n reports the email's result back onto it. The row id is the event
  // id n8n uses to drop duplicate deliveries.
  outbox: defineTable({
    type: loanEventTypeValidator,
    loanId: v.id("loans"),
    recipientId: v.id("users"),
    status: notificationStatusValidator,
    attempts: v.number(),
    // When the next delivery attempt is due; lets a cron find lost attempts.
    nextAttemptAt: v.number(),
    // Why delivery or sending failed, or why it was flagged.
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    // When n8n reported the email's result.
    resultAt: v.optional(v.number()),
  })
    .index("by_status_and_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_status_and_deliveredAt", ["status", "deliveredAt"])
    .index("by_loanId", ["loanId"]),

  // Overdue reminders n8n reports back, one per loan per day. The key is
  // `overdue:<loanId>:<date>`, so a retried write-back or a second run on the
  // same day updates or skips instead of adding a row.
  reminders: defineTable({
    reminderKey: v.string(),
    loanId: v.id("loans"),
    status: deliveryResultValidator,
    detail: v.optional(v.string()),
    occurredAt: v.number(),
  })
    .index("by_reminderKey", ["reminderKey"])
    .index("by_loanId", ["loanId"])
    .index("by_status_and_occurredAt", ["status", "occurredAt"]),
});
