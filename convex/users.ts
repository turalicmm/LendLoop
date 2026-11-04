import { mutation, query } from "./_generated/server";
import { getViewer } from "./lib/auth";
import { fail } from "./lib/errors";
import { displayName } from "./lib/validation";

/**
 * Creates or refreshes the caller's user row from their Clerk identity.
 * Name and email come from the verified JWT, never from client arguments,
 * so nobody can point notifications at someone else's inbox. The name is
 * cleaned (see `displayName`) because it appears in other people's emails.
 */
export const ensureCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("UNAUTHENTICATED", "Sign in to continue.");
    const name =
      displayName(identity.name) ??
      displayName(identity.givenName) ??
      displayName(identity.nickname) ??
      displayName(identity.email?.split("@")[0]) ??
      "Neighbour";
    const email = identity.email;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch("users", existing._id, { name, email });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: "user",
      trustedLender: false,
    });
  },
});

/** The caller's own profile. Returns null until `ensureCurrentUser` ran. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return {
      id: viewer._id,
      name: viewer.name,
      role: viewer.role,
      trustedLender: viewer.trustedLender,
    };
  },
});
