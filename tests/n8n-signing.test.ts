// @vitest-environment node
//
// The n8n workflows sign and verify requests in Code nodes. Those can't import
// convex/lib/signing.ts, so the scheme is written out four times in the
// exported JSON. These tests run that JavaScript, exactly as exported, against
// the Convex implementation, so the two sides can't drift apart unnoticed.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { signRequest, verifySignature } from "../convex/lib/signing";

const nodeRequire = createRequire(import.meta.url);
const TO_N8N = "secret-convex-to-n8n";
const TO_CONVEX = "secret-n8n-to-convex";
const SITE = "http://host.docker.internal:3211/";
const WEBHOOK_PATH = "/webhook/lendloop-loan-events";

function codeOf(workflow: string, node: string): string {
  const file = new URL(`../n8n/workflows/${workflow}.json`, import.meta.url);
  const exported = JSON.parse(readFileSync(file, "utf8")) as {
    nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
  };
  const code = exported.nodes.find((n) => n.name === node)?.parameters.jsCode;
  if (!code) throw new Error(`No Code node "${node}" in ${workflow}`);
  return code;
}

/** Runs a Code node's body the way n8n does, with only the globals it uses. */
async function runCodeNode(code: string, globals: Record<string, unknown>, self: object = {}) {
  const run = new Function(...Object.keys(globals), "require", `return (async function () {\n${code}\n}).call(this);`);
  return await run.call(self, ...Object.values(globals), nodeRequire);
}

/** n8n's `$('Node name').item.json` for the one node a Code node reads from. */
const upstream = (json: object) => () => ({ item: { json } });

async function expectConvexAccepts(method: string, path: string, output: { url: string; body?: string; timestamp: string; signature: string }) {
  expect(output.url).toBe(`http://host.docker.internal:3211${path}`);
  const verdict = await verifySignature(TO_CONVEX, {
    method,
    path,
    body: output.body ?? "",
    timestamp: output.timestamp,
    signature: output.signature,
  });
  expect(verdict).toEqual({ ok: true });
}

describe("n8n → Convex signatures, as exported", () => {
  test("workflow 01 signs the notification write-back", async () => {
    const out = await runCodeNode(codeOf("01-loan-event-notifications", "Sign write-back"), {
      $: upstream({ eventId: "evt1", loanId: "loan1" }),
      $json: { status: "failed", detail: "SMTP down" },
      $env: { N8N_TO_LENDLOOP_SECRET: TO_CONVEX, LENDLOOP_CONVEX_SITE_URL: SITE },
    });
    await expectConvexAccepts("POST", "/automation/events", out.json);
    expect(JSON.parse(out.json.body)).toMatchObject({
      idempotencyKey: "notify:evt1",
      loanId: "loan1",
      kind: "request_notification",
      status: "failed",
      detail: "SMTP down",
    });
  });

  test("workflow 02 signs the overdue-list request and the reminder write-back", async () => {
    const env = { N8N_TO_LENDLOOP_SECRET: TO_CONVEX, LENDLOOP_CONVEX_SITE_URL: SITE };
    const [request] = await runCodeNode(codeOf("02-overdue-reminders", "Sign overdue request"), { $env: env });
    await expectConvexAccepts("GET", "/automation/overdue-loans", request.json);

    const out = await runCodeNode(codeOf("02-overdue-reminders", "Sign write-back"), {
      $: upstream({ reminderKey: "overdue:loan1:2026-11-04", loanId: "loan1" }),
      $json: { status: "sent" },
      $env: env,
    });
    await expectConvexAccepts("POST", "/automation/events", out.json);
    expect(JSON.parse(out.json.body)).toMatchObject({
      idempotencyKey: "overdue:loan1:2026-11-04",
      kind: "overdue_reminder",
      status: "sent",
    });
  });
});

describe("Convex → n8n signatures, as exported", () => {
  const body = JSON.stringify({ eventId: "evt1", type: "loan.requested" });

  async function verifyInN8n(rawBody: string, headers: Record<string, string>) {
    return await runCodeNode(
      codeOf("01-loan-event-notifications", "Verify signature"),
      {
        $input: { first: () => ({ json: { headers, webhookUrl: `http://localhost:5678${WEBHOOK_PATH}` } }) },
        $env: { LENDLOOP_TO_N8N_SECRET: TO_N8N },
      },
      { helpers: { getBinaryDataBuffer: async () => Buffer.from(rawBody) } },
    );
  }

  test("workflow 01 accepts what Convex signs, and nothing else", async () => {
    const { timestamp, signature } = await signRequest(TO_N8N, "POST", WEBHOOK_PATH, body);
    const headers = { "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature };

    expect(await verifyInN8n(body, headers)).toEqual([{ json: { valid: true, event: JSON.parse(body) } }]);
    expect((await verifyInN8n(`${body} `, headers))[0].json.valid).toBe(false);

    const stale = await signRequest(TO_N8N, "POST", WEBHOOK_PATH, body, Math.floor(Date.now() / 1000) - 600);
    const staleHeaders = { "x-lendloop-timestamp": stale.timestamp, "x-lendloop-signature": stale.signature };
    expect((await verifyInN8n(body, staleHeaders))[0].json.valid).toBe(false);

    const otherSecret = await signRequest("not-the-secret", "POST", WEBHOOK_PATH, body);
    const forged = { "x-lendloop-timestamp": otherSecret.timestamp, "x-lendloop-signature": otherSecret.signature };
    expect((await verifyInN8n(body, forged))[0].json.valid).toBe(false);
  });
});
