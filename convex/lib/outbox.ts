import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { LoanEventType } from "./constants";

/**
 * Records a loan event in the outbox and schedules its delivery to n8n.
 * Called inside the same mutation that changes the loan, so the event is
 * written if and only if the change commits.
 */
export async function enqueueLoanEvent(
  ctx: MutationCtx,
  event: { type: LoanEventType; loanId: Id<"loans">; recipientId: Id<"users"> },
): Promise<Id<"outbox">> {
  const outboxId = await ctx.db.insert("outbox", {
    ...event,
    status: "pending",
    attempts: 0,
    nextAttemptAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { outboxId });
  return outboxId;
}
