import type { AuthConfig } from "convex/server";

// Clerk issues the JWT (template/integration named "convex"); Convex verifies
// it against this issuer. Set CLERK_JWT_ISSUER_DOMAIN in the Convex dashboard
// or with `npx convex env set`.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
