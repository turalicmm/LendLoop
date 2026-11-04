import { v, type ObjectType } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { can, getViewer, requireViewer } from "./lib/auth";
import { categoryValidator, conditionValidator, LIMITS } from "./lib/constants";
import { fail } from "./lib/errors";
import { hourlyLimitReached } from "./lib/limits";
import { loansForTool } from "./lib/loans";
import { enqueueLoanEvent } from "./lib/outbox";
import { loadLiveTool, toolAvailability, toolSummary } from "./lib/tools";
import { cleanText, firstName, hasLink, requireIsoDate, todayIso } from "./lib/validation";

const LIST_LIMIT = 500;
const OWN_LISTINGS_LIMIT = 200;
const PENDING_PER_BATCH = 50;

/** Live (not removed) listings, optionally in one category, newest first. */
async function liveTools(ctx: QueryCtx, category: Doc<"tools">["category"] | undefined) {
  const tools = ctx.db.query("tools");
  const live = category
    ? tools.withIndex("by_removedAt_and_category", (q) => q.eq("removedAt", undefined).eq("category", category))
    : tools.withIndex("by_removedAt", (q) => q.eq("removedAt", undefined));
  return await live.order("desc").take(LIST_LIMIT);
}

function byName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name);
}

/**
 * Public landing page list. Anonymous visitors only learn that a tool exists
 * and is free today: name and category, nothing about who owns it.
 */
export const listPublic = query({
  args: { today: v.string(), category: v.optional(categoryValidator) },
  handler: async (ctx, { today, category }) => {
    requireIsoDate(today);
    const tools = await liveTools(ctx, category);
    const rows = await Promise.all(
      tools.map(async (tool) => ({ tool, availability: await toolAvailability(ctx, tool._id, today) })),
    );
    return rows
      .filter((row) => row.availability.state === "available")
      .map(({ tool }) => ({ id: tool._id, name: tool.name, category: tool.category }))
      .sort(byName);
  },
});

/** Signed-in catalogue: every listing with today's availability. */
export const list = query({
  args: { today: v.string(), category: v.optional(categoryValidator) },
  handler: async (ctx, { today, category }) => {
    requireIsoDate(today);
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const tools = await liveTools(ctx, category);
    const rows = await Promise.all(
      tools.map(async (tool) => {
        const [owner, availability] = await Promise.all([
          ctx.db.get("users", tool.ownerId),
          toolAvailability(ctx, tool._id, today),
        ]);
        return {
          ...toolSummary(tool),
          isMine: tool.ownerId === viewer._id,
          lender: {
            firstName: owner ? firstName(owner.name) : "Neighbour",
            trusted: owner?.trustedLender ?? false,
          },
          availability,
        };
      }),
    );
    return rows.sort(byName);
  },
});

export const myListings = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    requireIsoDate(today);
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_ownerId_and_removedAt", (q) => q.eq("ownerId", viewer._id).eq("removedAt", undefined))
      .order("desc")
      .take(OWN_LISTINGS_LIMIT);
    return await Promise.all(
      tools.map(async (tool) => {
        const [pending, availability] = await Promise.all([
          loansForTool(ctx, tool._id, "requested"),
          toolAvailability(ctx, tool._id, today),
        ]);
        return { ...toolSummary(tool), pendingRequests: pending.length, availability };
      }),
    );
  },
});

const toolFields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

/**
 * The editable fields, trimmed and length-checked on the server. The name
 * appears in other people's emails, so it can't carry a link.
 */
function cleanToolFields(args: ObjectType<typeof toolFields>) {
  const name = cleanText(args.name, "Name", { max: LIMITS.toolName });
  if (hasLink(name)) fail("INVALID", "A tool name can't contain a link.");
  return {
    name,
    category: args.category,
    condition: args.condition,
    description: cleanText(args.description, "Description", { max: LIMITS.toolDescription, multiline: true }),
  };
}

/** One account can't flood the shared catalogue: a cap on live listings, and on new ones per hour. */
async function enforceListingLimits(ctx: QueryCtx, ownerId: Id<"users">) {
  const live = await ctx.db
    .query("tools")
    .withIndex("by_ownerId_and_removedAt", (q) => q.eq("ownerId", ownerId).eq("removedAt", undefined))
    .take(LIMITS.maxListingsPerUser);
  if (live.length >= LIMITS.maxListingsPerUser) {
    fail("RATE_LIMITED", `You can have at most ${LIMITS.maxListingsPerUser} listings. Remove one first.`);
  }
  const recent = await ctx.db
    .query("tools")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .order("desc")
    .take(LIMITS.maxListingsPerHour);
  if (hourlyLimitReached(recent, LIMITS.maxListingsPerHour)) {
    fail("RATE_LIMITED", "You've listed a lot of tools in the last hour. Please try again later.");
  }
}

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const fields = cleanToolFields(args);
    await enforceListingLimits(ctx, viewer._id);
    return await ctx.db.insert("tools", { ownerId: viewer._id, ...fields });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const viewer = await requireViewer(ctx);
    const tool = await loadLiveTool(ctx, toolId);
    if (!can.editTool(viewer, tool)) fail("FORBIDDEN", "You can only edit your own listings.");
    await ctx.db.patch("tools", toolId, cleanToolFields(args));
  },
});

/**
 * Owners remove their own listings; admins can remove any (moderation).
 * Open requests and future bookings are closed and the borrowers told. An
 * owner can't pull a tool that is currently lent out; an admin can, and the
 * loan stays on record.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireViewer(ctx);
    const tool = await loadLiveTool(ctx, toolId);
    if (!can.removeTool(viewer, tool)) fail("FORBIDDEN", "You can only remove your own listings.");

    const today = todayIso();
    const approved = await loansForTool(ctx, toolId, "approved");
    if (viewer.role !== "admin" && approved.some((loan) => loan.startDate <= today)) {
      fail("CONFLICT", "This tool is lent out. Mark it as returned before removing it.");
    }

    await ctx.db.patch("tools", toolId, { removedAt: Date.now(), removedBy: viewer._id });
    for (const loan of approved.filter((loan) => loan.startDate > today)) {
      await closeForRemoval(ctx, loan);
    }
    await closeOpenRequests(ctx, toolId);
  },
});

async function closeForRemoval(ctx: MutationCtx, loan: Doc<"loans">) {
  await ctx.db.patch("loans", loan._id, { status: "cancelled", decidedAt: Date.now() });
  await enqueueLoanEvent(ctx, { type: "loan.listing_removed", loanId: loan._id, recipientId: loan.borrowerId });
}

/**
 * Closes a removed tool's open requests in batches, so a tool with a long
 * queue of requests can't push one mutation past Convex's limits. Each batch
 * schedules the next until none are left.
 */
async function closeOpenRequests(ctx: MutationCtx, toolId: Id<"tools">) {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_toolId_and_status", (q) => q.eq("toolId", toolId).eq("status", "requested"))
    .take(PENDING_PER_BATCH);
  for (const loan of pending) await closeForRemoval(ctx, loan);
  if (pending.length === PENDING_PER_BATCH) {
    await ctx.scheduler.runAfter(0, internal.tools.closeRemainingRequests, { toolId });
  }
}

export const closeRemainingRequests = internalMutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const tool = await ctx.db.get("tools", toolId);
    if (tool?.removedAt === undefined) return;
    await closeOpenRequests(ctx, toolId);
  },
});
