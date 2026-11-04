import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { fail } from "./errors";

export type Viewer = Doc<"users">;

/** The signed-in user's row, or null for anonymous visitors. */
export async function getViewer(ctx: QueryCtx): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireViewer(ctx: QueryCtx): Promise<Viewer> {
  const viewer = await getViewer(ctx);
  if (!viewer) fail("UNAUTHENTICATED", "Sign in to continue.");
  return viewer;
}

export async function requireAdmin(ctx: QueryCtx): Promise<Viewer> {
  const viewer = await requireViewer(ctx);
  if (viewer.role !== "admin") fail("FORBIDDEN", "Only admins can do that.");
  return viewer;
}

/**
 * Every ownership rule in one place. Functions call these before writing,
 * so the UI hiding a button is a convenience, not the access control.
 */
export const can = {
  editTool: (viewer: Viewer, tool: Doc<"tools">) => tool.ownerId === viewer._id,
  removeTool: (viewer: Viewer, tool: Doc<"tools">) =>
    tool.ownerId === viewer._id || viewer.role === "admin",
  borrowTool: (viewer: Viewer, tool: Doc<"tools">) => tool.ownerId !== viewer._id,
  decideRequest: (viewer: Viewer, loan: Doc<"loans">) => loan.ownerId === viewer._id,
  cancelRequest: (viewer: Viewer, loan: Doc<"loans">) => loan.borrowerId === viewer._id,
  markReturned: (viewer: Viewer, loan: Doc<"loans">) => loan.ownerId === viewer._id,
};
