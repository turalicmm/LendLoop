import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { fail } from "./errors";
import { loansForTool } from "./loans";

export type Availability =
  | { state: "available"; nextReservedFrom?: string }
  | { state: "on_loan"; until: string }
  | { state: "overdue"; dueSince: string };

/** Derives a tool's state today from its approved (not yet returned) loans. */
export function availabilityFrom(
  approvedLoans: Array<{ startDate: string; endDate: string }>,
  today: string,
): Availability {
  let nextReservedFrom: string | undefined;
  for (const loan of approvedLoans) {
    if (loan.startDate <= today) {
      return loan.endDate < today
        ? { state: "overdue", dueSince: loan.endDate }
        : { state: "on_loan", until: loan.endDate };
    }
    if (!nextReservedFrom || loan.startDate < nextReservedFrom) {
      nextReservedFrom = loan.startDate;
    }
  }
  return { state: "available", nextReservedFrom };
}

export async function toolAvailability(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  today: string,
): Promise<Availability> {
  return availabilityFrom(await loansForTool(ctx, toolId, "approved"), today);
}

/** A listing that hasn't been removed, or NOT_FOUND. */
export async function loadLiveTool(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"tools">> {
  const tool = await ctx.db.get("tools", toolId);
  if (!tool || tool.removedAt !== undefined) fail("NOT_FOUND", "Listing not found.");
  return tool;
}

/** The fields every view of a listing shows. */
export function toolSummary(tool: Doc<"tools">) {
  return {
    id: tool._id,
    name: tool.name,
    category: tool.category,
    condition: tool.condition,
    description: tool.description,
  };
}
