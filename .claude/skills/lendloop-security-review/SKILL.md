---
name: lendloop-security-review
description: Security review checklist for LendLoop's Convex backend and n8n workflows. Use before committing changes to convex/ or n8n/workflows/, or when asked to audit access control, data exposure, loan state transitions, webhook signing or reminder idempotency.
---

# LendLoop security review

Review every changed file under `convex/` and `n8n/workflows/` against the checks below. For each finding give the file and line, a concrete exploit or failure scenario, and the fix. Do not report style issues.

## 1. Ownership and roles
- Every public `query`/`mutation` that reads or writes user data calls `requireViewer` / `requireAdmin` (`convex/lib/auth.ts`) or returns nothing for anonymous callers.
- Every write that touches a tool or loan checks the matching rule in `can.*` **after** loading the document, using ids from the database (`tool.ownerId`, `loan.ownerId`, `loan.borrowerId`), never ids from arguments.
- No client-callable function can change `users.role` or `users.trustedLender` without `requireAdmin`. `admin:setRole` must stay an `internalMutation`.
- `ensureCurrentUser` takes name and email only from `ctx.auth.getUserIdentity()`, never from arguments, and stores the name through `displayName` (no link-like words), because names appear in other people's emails.
- Anything else user-typed that reaches an email (tool names) is refused if `hasLink` matches.

## 2. Data exposure
- `tools.listPublic` returns only `id`, `name`, `category` for available, non-removed tools.
- Signed-in views show other users' **first name** and `trustedLender` only. Email appears only in admin queries, in payloads sent to n8n for the recipient themselves, and to the other person on a loan while it is `approved` (`counterparty.email` in `loanRow`).
- A loan's `message` is visible only to its lender and its borrower (`loanRow` in `convex/loans.ts`), never to other users, admins' loan lists or n8n.
- n8n payloads (`notifications.payloadFor`, `reminders.overdueLoans`) contain no descriptions, messages, Clerk ids or other users' contact details.

## 3. Loan state machine
Allowed transitions, each enforced in `convex/loans.ts` or `convex/tools.ts`:

| From | To | Who | Extra condition |
|---|---|---|---|
| requested | approved | lender | start date not passed, no overlap with approved loans |
| requested | declined | lender, or automatic on overlapping approval | |
| requested | cancelled | borrower, or listing removal | |
| approved | cancelled | borrower (before start), or listing removal (future loans) | |
| approved | returned | lender | loan has started (`startDate <= today`) |

Flag any path that reaches another transition, skips the status check, or reads the status outside the mutation that writes it.

An approved loan blocks its days; an overdue one (`occupiedRange`) blocks every later day until it is marked returned. A request can be approved only until its first day (`isApprovable`); `loans.expireUnanswered` closes it after that.

Anything that emails another user must be throttled: `loans.request` enforces `LIMITS.maxRequestsPerHour` and `LIMITS.maxOpenRequestsPerTool` by counting real rows inside the mutation. A new email-triggering mutation needs the same treatment. Listing creation is capped too (`LIMITS.maxListingsPerUser`, `maxListingsPerHour`), so one account can't flood the shared catalogue.

## 4. Webhook signatures (both directions)
- Canonical string is `${timestamp}.${METHOD}.${path}.${rawBody}` on both sides (`convex/lib/signing.ts`, the Code nodes in `n8n/workflows/`).
- Verification uses the **raw** body, checks the timestamp window (300 s) and compares in constant time.
- Rejections return a generic 401; the reason is only logged.
- Secrets are read from env (`process.env.*`, `$env.*`) and never appear in code or workflow JSON. Run `grep -rn "sha256=" n8n/workflows` and check nothing looks like a literal key. `tests/n8n-signing.test.ts` must keep passing: it runs the workflows' signing code against `convex/lib/signing.ts`.

## 5. Idempotency and duplicates
- Each outbox event is delivered at most once per attempt, and n8n drops repeats by `eventId` (Remove Duplicates, workflow scope).
- `notifications.recordResult` (onto the outbox row) and `reminders.recordReminder` (keyed `overdue:<loanId>:<date>`) record the first result; the only allowed change afterwards is `failed` → `sent`. Each checks that the key names the loan in the body.
- `reminders.overdueLoans` skips loans whose `overdue:<loanId>:<date>` key is already `sent`.
- Retried write-backs must not create a second reminder row or flip a notification back (see `tests/automation.test.ts`).
- `/automation/events` accepts a key only with its kind's prefix (`notify:` or `overdue:`). A reminder key must be today's or yesterday's key for a loan that was overdue that day, and `occurredAt` is clamped to now.
- Workflow 02 drops repeats of `reminderKey` (Remove Duplicates) before sending.
- No outbox row can stay `pending` forever: `deliver` records every outcome, and `notifications.sweepStuck` (cron) re-schedules overdue attempts.
- `admin.resendNotification` (the only re-send) checks the loan still has the status the notice describes (`STATUS_FOR_EVENT`), so an out-of-date notice is dismissed, never sent.
- No accepted event can vanish: a row still `delivered` 15 minutes later becomes `unconfirmed` (`notifications.flagUnconfirmed`) and shows in the admin panel.
- n8n workflows save only failed and manual executions (`saveDataSuccessExecution: "none"`), because executions hold names and emails.
- n8n Code nodes never throw on malformed input from the webhook; they return a 401 instead, so junk requests can't trigger the ops error workflow.

## 6. Convex guidelines that affect security
- Queries take `today` as a validated argument and never read the clock; mutations use server time for decisions.
- All reads are bounded (`.take(n)` or a bounded `for await`), so no public query can be made arbitrarily expensive.
- Env vars come from `env` (`convex/convex.config.ts`), and `docker-compose.yml` publishes ports on `127.0.0.1` only.

## 7. Verify
```bash
npm test && npm run lint && npm run typecheck
```
Add a test in `tests/` for every access-control or idempotency bug you find before fixing it.
