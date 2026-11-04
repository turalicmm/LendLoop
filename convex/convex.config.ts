import { defineApp } from "convex/server";
import { v } from "convex/values";

// Typed deployment environment. Functions read these through `env` from
// ./_generated/server. Set them with `npx convex env set NAME value`.
// CLERK_JWT_ISSUER_DOMAIN is read by auth.config.ts.
const app = defineApp({
  env: {
    CLERK_JWT_ISSUER_DOMAIN: v.string(),
    // The n8n integration is optional: without it, events stay visible as
    // failed deliveries in the admin panel instead of breaking mutations.
    N8N_LOAN_EVENTS_WEBHOOK_URL: v.optional(v.string()),
    LENDLOOP_TO_N8N_SECRET: v.optional(v.string()),
    N8N_TO_LENDLOOP_SECRET: v.optional(v.string()),
    APP_URL: v.optional(v.string()),
    ALLOW_DEV_SEED: v.optional(v.literal("true")),
  },
});

export default app;
