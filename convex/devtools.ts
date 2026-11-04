import { v } from "convex/values";
import { env, internalMutation } from "./_generated/server";
import { addDays, todayIso } from "./lib/validation";

// Local demo helper. Internal (no client can call it) and refuses to run
// unless the deployment sets ALLOW_DEV_SEED=true, so it is inert in prod.
//
//   npx convex env set ALLOW_DEV_SEED true
//   npx convex run devtools:makeLoanOverdue '{"loanId":"<id>","daysOverdue":2}'

export const makeLoanOverdue = internalMutation({
  args: { loanId: v.id("loans"), daysOverdue: v.optional(v.number()) },
  handler: async (ctx, { loanId, daysOverdue = 2 }) => {
    if (env.ALLOW_DEV_SEED !== "true") {
      throw new Error("Set ALLOW_DEV_SEED=true on this deployment to use devtools.");
    }
    const loan = await ctx.db.get("loans", loanId);
    if (!loan || loan.status !== "approved") throw new Error("Pick an approved loan.");
    const endDate = addDays(todayIso(), -daysOverdue);
    const startDate = addDays(endDate, -3);
    await ctx.db.patch("loans", loanId, { startDate, endDate });
    return { startDate, endDate };
  },
});
