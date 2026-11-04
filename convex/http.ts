import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { env, httpAction } from "./_generated/server";
import {
  DELIVERY_RESULTS,
  WRITE_BACK_KEY_PREFIX,
  type DeliveryResult,
  type WriteBackKind,
} from "./lib/constants";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./lib/signing";
import { todayIso } from "./lib/validation";

// Endpoints n8n calls. Every request must carry a fresh HMAC signature made
// with N8N_TO_LENDLOOP_SECRET (see lib/signing.ts). There is no CORS: these
// are server-to-server only.

const MAX_BODY_BYTES = 8 * 1024;
const KEY_PATTERN = /^[a-z_]+:[A-Za-z0-9:_-]{1,150}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function authenticate(request: Request, body: string): Promise<Response | null> {
  const secret = env.N8N_TO_LENDLOOP_SECRET;
  if (!secret) {
    console.error("N8N_TO_LENDLOOP_SECRET is not set; rejecting automation request");
    return json(503, { error: "automation endpoint not configured" });
  }
  const result = await verifySignature(secret, {
    method: request.method,
    path: new URL(request.url).pathname,
    body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
  if (!result.ok) {
    // The reason is logged, not returned, so callers can't probe the scheme.
    console.warn(`Rejected automation request to ${new URL(request.url).pathname}: ${result.reason}`);
    return json(401, { error: "invalid signature" });
  }
  return null;
}

/**
 * A write-back from n8n, parsed from untrusted JSON. The idempotency key says
 * which record it belongs to: `notify:<outboxId>` for a loan notification,
 * `overdue:<loanId>:<date>` for a reminder. A key must carry its kind's
 * prefix, so one kind can never overwrite the other's record.
 */
type WriteBack = {
  kind: WriteBackKind;
  key: string;
  loanId: string;
  status: DeliveryResult;
  detail?: string;
  occurredAt: number;
};

const isKind = (value: unknown): value is WriteBackKind =>
  typeof value === "string" && Object.hasOwn(WRITE_BACK_KEY_PREFIX, value);
const isResult = (value: unknown): value is DeliveryResult =>
  (DELIVERY_RESULTS as readonly unknown[]).includes(value);

function parseWriteBack(body: string): WriteBack | null {
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof input !== "object" || input === null) return null;
  const { idempotencyKey: key, loanId, kind, status, detail, occurredAt } = input as Record<string, unknown>;
  if (
    !isKind(kind) ||
    typeof key !== "string" ||
    !KEY_PATTERN.test(key) ||
    !key.startsWith(WRITE_BACK_KEY_PREFIX[kind]) ||
    typeof loanId !== "string" ||
    !isResult(status) ||
    !(detail === undefined || detail === null || typeof detail === "string")
  ) {
    return null;
  }
  const when = typeof occurredAt === "string" ? Date.parse(occurredAt) : NaN;
  return {
    kind,
    key,
    loanId,
    status,
    detail: detail ?? undefined,
    // A result can't be from the future; clamp so a bad clock can't pin a row to the top.
    occurredAt: Number.isNaN(when) ? Date.now() : Math.min(when, Date.now()),
  };
}

const http = httpRouter();

http.route({
  path: "/automation/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const rejected = await authenticate(request, "");
    if (rejected) return rejected;
    const today = todayIso();
    const loans = await ctx.runQuery(internal.reminders.overdueLoans, { today });
    return json(200, { asOf: today, count: loans.length, loans });
  }),
});

http.route({
  path: "/automation/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Refuse a declared oversize body before reading it; the second check
    // covers bodies sent without a Content-Length.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return json(413, { error: "body too large" });
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      return json(413, { error: "body too large" });
    }
    const rejected = await authenticate(request, body);
    if (rejected) return rejected;

    const writeBack = parseWriteBack(body);
    if (!writeBack) return json(400, { error: "invalid event" });
    const { kind, key, ...result } = writeBack;
    const outcome =
      kind === "request_notification"
        ? await ctx.runMutation(internal.notifications.recordResult, {
            eventId: key.slice(WRITE_BACK_KEY_PREFIX.request_notification.length),
            ...result,
          })
        : await ctx.runMutation(internal.reminders.recordReminder, { reminderKey: key, ...result });
    if (outcome === "unknown") return json(404, { error: "unknown loan or event" });
    return json(200, { ok: true, result: outcome });
  }),
});

export default http;
