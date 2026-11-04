# LendLoop: browser QA report

**Date:** 4 November 2026
**Result:** 74 checks run, 74 passed, 0 failed. 2 checks not run; see [What was not tested](#what-was-not-tested).

The run found one issue, a hydration warning caused by a browser extension. It was fixed and re-tested; see [Issues found](#issues-found).

Each result was observed while running the system, not inferred from the code. Where a check used the Convex CLI or a script instead of the browser, the table says so.

The browser sessions were driven by Claude (Anthropic) through the Claude in Chrome extension. The scripted checks were run from the same session.

## Environment

| Part | Version | Where |
| --- | --- | --- |
| Next.js (App Router, `next dev`) | 16.4.5 | `http://localhost:3000` |
| Clerk (`@clerk/nextjs`) | 7.9.24, **development** instance | Clerk-hosted |
| Convex (local backend) | 1.49 | `127.0.0.1:3210` (API), `:3211` (HTTP actions) |
| n8n (Docker) | 2.46.4 | `localhost:5678` |
| Mailpit (SMTP sink) | – | `localhost:8025` |

Browsers used:

- **Real Google Chrome**, driven through Claude in Chrome: every signed-in check.
- **Playwright Chromium 145**, in fresh incognito contexts: anonymous checks and screenshots.

### Test accounts

| Label | What it is | How it was driven |
| --- | --- | --- |
| **A** | The developer's Clerk development account, role `admin` | Real Chrome. The developer signed in by hand; the automation reused that session. |
| **Alice** | Test identity `local\|alice` (lender) | Convex CLI `--identity` |
| **Bob** | Test identity `local\|bob` (borrower) | Convex CLI `--identity` |
| **Carol** | Test identity `local\|carol` (unrelated neighbour) | Convex CLI `--identity` |

The test identities call the same public Convex functions as the browser, and the functions apply the same access checks. One step is skipped: Clerk JWT verification, because the CLI supplies the identity directly.

The test identities use emails on the reserved `.test` domain. This report and its screenshots contain no credentials, keys or real email addresses.

## Results

### 1. Environment

| ID | Check | Result |
| --- | --- | --- |
| ENV-1 | Next.js dev server answers `200` | PASS |
| ENV-2 | Convex backend up, functions pushed with typecheck on | PASS |
| ENV-3 | n8n healthy, all three workflows imported | PASS |
| ENV-4 | Mailpit receives mail sent by n8n | PASS |
| ENV-5 | `clerk doctor`: every check passes | PASS |

### 2. Public page, signed out

Checked in fresh Playwright contexts at 1440×900, 768×1024 and 390×844.

| ID | Check | Result |
| --- | --- | --- |
| PUB-1 | Page renders at all three sizes with no horizontal scroll | PASS |
| PUB-2 | Tool cards show name and category only | PASS |
| PUB-3 | Convex WebSocket payload for the public list has only `id`, `name` and `category`: no owner, email or description | PASS |
| PUB-4 | Category filter works and shows an empty state when nothing matches | PASS |
| PUB-5 | "Sign in" opens the Clerk modal | PASS |
| PUB-6 | Opening `/dashboard` signed out redirects to Clerk sign-in | PASS |
| PUB-7 | Console: 0 errors | PASS |
| PUB-8 | Direct API calls with no session are refused with `UNAUTHENTICATED`: `tools:create`, `loans:request`, `tools:remove` and `admin:members`. The signed-in catalogue (`tools:list`) returns 0 rows. | PASS |
| PUB-9 | A forged JWT is rejected (`NoAuthProvider`) | PASS |

PUB-8 and PUB-9 were re-run at the end of QA, after the last code change.

Screenshots (signed out):

- [`public-desktop.png`](docs/qa/screenshots/public-desktop.png)
- [`public-tablet.png`](docs/qa/screenshots/public-tablet.png)
- [`public-mobile.png`](docs/qa/screenshots/public-mobile.png)
- [`clerk-sign-in-modal.png`](docs/qa/screenshots/clerk-sign-in-modal.png)

### 3. Authentication

| ID | Check | Result |
| --- | --- | --- |
| AUTH-1 | Sign-in with Clerk works; the dashboard loads for A | PASS. The developer entered their own credentials; the automation checked the result. |
| AUTH-2 | Session survives a page refresh | PASS |
| AUTH-3 | First sign-in creates the Convex `users` row from the verified token (Clerk issuer plus a `user_…` subject) | PASS |
| AUTH-4 | Internal functions can't be called from a browser client. Probed: `admin:setRole`, `loans:expireUnanswered`, `notifications:recordResult`, `reminders:overdueLoans`. All return "Could not find public function". | PASS |
| AUTH-5 | Sign-out | **NOT RUN.** See [What was not tested](#what-was-not-tested). |
| AUTH-6 | Clerk sign-up, and a second real Clerk user in a browser | **NOT RUN.** No Clerk test accounts were created. Alice, Bob and Carol stood in for the other users. |

### 4. Lending as User A (real Chrome)

| ID | Check | Result |
| --- | --- | --- |
| LEND-1 | Empty name: inline "Name is required." | PASS |
| LEND-2 | Name containing a link: inline "A tool name can't contain a link." | PASS |
| LEND-3 | Created "QA Torque wrench" with a multi-line description. The line breaks show on the card and the Convex record matches the form. | PASS |
| LEND-4 | Changed condition to Fair; the change persists after refresh | PASS |
| LEND-5 | All tools: category filter and availability badges | PASS |
| LEND-6 | Removed "QA Temp item" through the inline confirmation. It disappears from My listings, All tools and the public page, and `removedAt` is set. | PASS |

### 5. Loan lifecycle with two users

A lends to Bob. A also borrows from Alice.

| ID | Check | Result |
| --- | --- | --- |
| LIFE-1 | Bob requests A's tool. The loan row is created, Bob sees it in My requests, and it appears live in A's Incoming requests. | PASS |
| LIFE-2 | A approves in the browser. Both sides see Approved and the other party's email (shown only while the loan is approved). Availability shows the booking. The request and approval emails reach the right inboxes. | PASS |
| LIFE-3 | A declines a second request. Bob sees Declined, availability is unchanged, and the decline email is sent. | PASS |
| LIFE-4 | A marks an overdue loan returned in the browser. Status becomes Returned and the tool is available again. A second "returned" call is refused (`CONFLICT`). | PASS |
| LIFE-5 | A borrows from Alice in the browser. Success notice shown; a duplicate request is refused inline; Alice's approval appears live without refresh; cancelling uses an inline confirmation. | PASS |

### 6. Server-side refusals

Each one was sent as a direct call with a test identity, so the UI could not block it first. All were re-run at the end of QA after the last code change: 19 of 19 refused with the expected code.

| ID | Attempt | Expected | Result |
| --- | --- | --- | --- |
| REF-1 | Impossible calendar date (`2026-02-30`) | `INVALID` | PASS |
| REF-2 | Start date in the past | `INVALID` | PASS |
| REF-3 | End date before start date | `INVALID` | PASS |
| REF-4 | Loan longer than 30 days | `INVALID` | PASS |
| REF-5 | Start more than 90 days ahead | `INVALID` | PASS |
| REF-6 | Bob approves his own request | `FORBIDDEN` | PASS |
| REF-7 | Carol approves a loan she is not part of | `FORBIDDEN` | PASS |
| REF-8 | Carol declines it | `FORBIDDEN` | PASS |
| REF-9 | Carol cancels it | `FORBIDDEN` | PASS |
| REF-10 | Carol marks someone else's loan returned | `FORBIDDEN` | PASS |
| REF-11 | Carol edits Alice's listing | `FORBIDDEN` | PASS |
| REF-12 | Carol removes Alice's listing | `FORBIDDEN` | PASS |
| REF-13 | Alice requests her own tool | `FORBIDDEN` | PASS |
| REF-14 | Duplicate request for the same days | `CONFLICT` | PASS |
| REF-15 | Approve a loan that is already approved | `CONFLICT` | PASS |
| REF-16 | Decline after approval | `CONFLICT` | PASS |
| REF-17 | Mark returned before the loan starts | `CONFLICT` | PASS |
| REF-18 | Request days that are already approved for someone else | `CONFLICT` | PASS |
| REF-19 | Request a tool whose last loan is overdue | `CONFLICT` | PASS |

### 7. Admin

| ID | Check | Result |
| --- | --- | --- |
| ADM-1 | A sees the Admin tab. All loans lists 19 of 19 loans, including ones A is not part of. | PASS |
| ADM-2 | A removes another member's listing ("QA Bob listing") from All tools | PASS |
| ADM-3 | A marks Bob Trusted Lender. The badge shows and the setting persists after refresh. | PASS |
| ADM-4 | Carol calls `admin:members` | PASS (`FORBIDDEN`) |
| ADM-5 | Carol calls `admin:allLoans` | PASS (`FORBIDDEN`) |
| ADM-6 | Carol calls `admin:setTrustedLender` | PASS (`FORBIDDEN`) |
| ADM-7 | Carol calls `admin:automationHealth` | PASS (`FORBIDDEN`) |

ADM-4 to ADM-7 were re-run at the end of QA.

### 8. n8n automation (live, real workflows)

| ID | Check | Result |
| --- | --- | --- |
| N8N-1 | Each request, approval, decline, cancellation, return and listing removal creates one outbox row. n8n sends it, and its signed write-back marks the row `sent`. Each email arrived in the right Mailpit inbox. | PASS. Final tally: 38 `sent`, 5 `resent`, 0 pending, failed or unconfirmed. |
| N8N-2 | Overdue workflow runs daily at 08:00 Europe/Sarajevo | PASS (workflow settings inspected) |
| N8N-3 | Signed GET of overdue loans returns `200` with only the fields the reminder needs | PASS |
| N8N-4 | Manual run: one reminder sent, written back as `sent`. The loan shows "Overdue reminder sent" in the browser. | PASS |
| N8N-5 | Second run on the same day: 0 reminders sent (idempotent) | PASS |
| N8N-6 | An already-handled event replayed twice: `202`, 0 extra emails | PASS |
| N8N-7 | Requests with no signature, a wrong signature, or a timestamp an hour old: `401` from both Convex endpoints. The same holds for the n8n webhook (no signature or a wrong one). | PASS (8 probes, re-run at the end) |
| N8N-8 | With Mailpit stopped, the email fails (`EHOSTUNREACH`) and appears under Automation health. Admin Resend in the browser then sends it: the new row is `sent`, the old one `resent`. | PASS |
| N8N-9 | A failed write-back triggers the error workflow, which sends an ops alert | PASS |

### 9. Responsive layout, signed in (real Chrome)

All five tabs (All tools, My listings, My requests, Incoming requests, Admin) were checked at each size, 15 combinations in all.

| ID | Size | Result |
| --- | --- | --- |
| RESP-1 | 390×844 | PASS: no horizontal scroll; tab bar wraps |
| RESP-2 | 768×1024 | PASS |
| RESP-3 | 1440×900 | PASS |

### 10. Console and network (real Chrome)

| ID | Check | Result |
| --- | --- | --- |
| CON-1 | Every network request during the signed-in session returned `200` | PASS |
| CON-2 | The only console warning is Clerk's expected "development keys" notice. Convex logs show only the refusals the negative tests caused on purpose. | PASS |
| CON-3 | No hydration warnings | PASS after fix. It failed first; see below. |

### 11. Automated checks (run after the last code change)

| ID | Check | Result |
| --- | --- | --- |
| AUTO-1 | `npm test` (Vitest + convex-test) | PASS: 51 of 51 |
| AUTO-2 | `npm run lint` | PASS: 0 problems |
| AUTO-3 | `npm run typecheck` | PASS |
| AUTO-4 | `npm run build` | PASS |

## Issues found

| # | Issue | Cause | Fix | Re-test |
| --- | --- | --- | --- | --- |
| 1 | React hydration warning on `<body>` in Chrome | A browser extension (Grammarly) adds attributes to `<body>` before React hydrates | `suppressHydrationWarning` on `<body>` only, in `src/app/layout.tsx`, with a comment. It affects only that element's own attributes. | Clean console. The tests, lint, typecheck and build all still pass. |

**Not product bugs:**

- **Clerk bot protection in headless mode.** In headless Playwright, Clerk's bot-protection requests (`*.client.protect.clerk.com`) are aborted (`net::ERR_ABORTED`). Console errors stay at 0. In real Chrome these requests return `200`.
- **Chrome automation and React date inputs.** The automation's `form_input` call set the same React date input twice, and React ignored the second change. Typing the dates worked, and the server received the values the page showed.

## What was not tested

- **Sign-out (AUTH-5).**
  - Signing out would have ended the developer's own session. An isolated session would have needed a separate Clerk account; see the next item.
  - Sign-out is Clerk's `<UserButton />`, with no custom code.
  - The signed-out state is covered by PUB-6 (redirect from `/dashboard`) and PUB-8 (API calls refused).
- **Clerk sign-up, and a second real Clerk user (AUTH-6).**
  - No test accounts were created on the Clerk instance, because the browser automation does not create accounts or enter passwords.
  - Multi-user behaviour was verified with the Convex test identities above instead. They run the same functions and the same server-side checks; only Clerk's token verification is skipped.
  - To close this gap, create two users in the Clerk dashboard and follow the README walkthrough with one in a private window.
- **Real email deliverability.** Mailpit catches all mail; no real mailbox was used.
- **Hosted deployments.** Clerk ran on a development instance and Convex on a local backend. No cloud Convex deployment, production Clerk instance or public n8n webhook was tested.

## Clean-install verification

**Date:** 4 November 2026, after the README rewrite.

**Setup.** The repository's commit candidates were copied into an empty directory: 82 files, with no `.env*`, `.convex`, `node_modules` or `.next`. The README was then followed step by step against new local services (a new Convex backend, a new n8n volume, Mailpit). The HMAC secrets and the n8n encryption key were freshly generated. Steps 2 and 3 reused the existing Clerk development application; `clerk doctor` passes, and its session claims are `name` and `email`, as the README specifies.

| Step | Result |
| --- | --- |
| 1. `npm ci`, copy the env templates | 405 packages. 0 vulnerabilities in production dependencies. 16 moderate in the ESLint toolchain (`minimatch`, dev only). |
| 3. `CONVEX_AGENT_MODE=anonymous npx convex dev` | The first push stopped on `CLERK_JWT_ISSUER_DOMAIN`, as documented. After the five `convex env set` commands: "Convex functions ready!". The backend was separate and empty. |
| 4. `docker compose up -d`, `./n8n/setup.sh` | 1 credential and 3 workflows imported and published; n8n healthy. Unsigned calls to the n8n webhook and the Convex endpoint: `401`. |
| 5. `npm run dev` | `GET /` → `200`. Visiting `/dashboard` with a Clerk session created the user row (role `user`, no Admin tab). |
| 6. `npx convex run admin:setRole …` | Role `admin`. The Admin tab appeared without a reload. |
| Walkthrough 1–3 | Tool listed in the browser. A test borrower requested it, and "wants to borrow" reached the lender in Mailpit. Approved in the browser: handover contact shown; approval email sent. Outbox rows `sent`. |
| Walkthrough 4 | `makeLoanOverdue`, then `n8n execute`: one reminder sent and written back as `sent`. A second run the same day sent nothing (still 1 reminder row, 3 emails). |
| Walkthrough 5 | Mark as returned in the browser: loan `returned`, confirmation email sent |
| Walkthrough 6 | With Mailpit stopped, a new request's email failed (`connect EHOSTUNREACH`) and appeared under Admin → Automation health. After Mailpit restarted, Resend delivered it: new row `sent`, old row `resent`. |
| Signature probes | Missing, wrong and 10-minute-old signatures: `401` on both Convex endpoints. Missing and wrong signatures: `401` on the n8n webhook. Oversize body: `413`. |
| Final checks in the clean copy | `npm run typecheck`, `npm run lint`, `npm test` (51 of 51), `npm run build`, `docker compose config --quiet` and workflow JSON validation all passed |
| Browser console | No errors |

**One environment issue was found.**

- **Symptom.** A second overdue run was rejected with `401`, and the Convex log said "timestamp outside allowed window".
- **Cause.** Docker Desktop's VM clock was measured about 4 minutes behind the host, enough at times to exceed the 5-minute replay window. A few minutes later the drift was 0.
- **Re-run.** The same run then succeeded and sent nothing new.
- **What it shows.** The rejection was the replay protection working as designed.
- **Follow-up.** The README now has a troubleshooting note for this.

## How the checks were run

- **Browser checks.** Signed-in checks ran in real Chrome through Claude in Chrome. Anonymous checks ran in Playwright.
- **Server refusals and anonymous API probes.** Small scripts called the local Convex backend with `npx convex run --identity` and `ConvexHttpClient`. The scripts are not in the repository; `tests/access-control.test.ts` covers the same rules.
- **n8n checks.** They used n8n's CLI (`n8n execute --id`) and Mailpit's API to read delivered mail.
