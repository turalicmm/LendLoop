# LendLoop: verification summary

This file maps each requirement in the Fluence brief to its implementation and to the evidence that it works. The detailed results are in [BROWSER_QA_REPORT.md](BROWSER_QA_REPORT.md).

## Evidence at a glance

| Check | Result |
| --- | --- |
| Automated tests (`npm test`, Vitest + convex-test) | 51 of 51 passing |
| Lint, typecheck, production build | Clean |
| Browser and end-to-end QA | 74 checks run, 74 passed, 0 failed, 2 not run |
| Server-side refusal probes (direct calls as other users) | 19 of 19 refused with the expected error code |
| Signature probes (missing, wrong, stale) | 8 of 8 rejected with `401` |
| Clean install following the README (empty directory, new local services) | Setup steps 1–6 and walkthrough steps 1–6 passed; final checks clean in the copy |
| Secret scan of the repository and its git history | No credentials found |

The two checks not run:

- **Sign-out.**
- **A second real Clerk user in a browser.** Convex test identities stood in.

## Requirements and evidence

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Public page: name, tagline, tools with name and category only, from Convex | `src/app/page.tsx`, `tools.listPublic` | PUB-1 to PUB-4. The live WebSocket payload carries only `id`, `name` and `category`. |
| "Sign in to lend or borrow" wired to Clerk | Clerk `SignInButton`; `src/proxy.ts` protects `/dashboard` | PUB-5, PUB-6, AUTH-1 to AUTH-3 |
| List a tool: name, category, condition, description | `tools.create`, `tools.update`, `tools.remove` | LEND-1 to LEND-6 |
| Request to borrow for a date range | `loans.request` | LIFE-1, LIFE-5, REF-1 to REF-5 (date rules) |
| Approve or decline on your own tools | `loans.approve`, `loans.decline` | LIFE-2, LIFE-3, REF-6 to REF-9 |
| Mark a loan returned | `loans.markReturned` | LIFE-4, REF-10, REF-17 |
| All tools with availability, filterable by category | `tools.list` | LEND-5, PUB-4 |
| My listings, My requests, Incoming requests | Dashboard tabs | LIFE-1 to LIFE-5; RESP-1 to RESP-3 |
| Admin: remove any listing, view all loans, Trusted Lender | `tools.remove`, `admin.allLoans`, `admin.setTrustedLender` | ADM-1 to ADM-3 |
| User rights enforced in Convex, not only in the UI | `convex/lib/auth.ts` (`can.*`, `requireAdmin`) | REF-6 to REF-13, ADM-4 to ADM-7, AUTH-4, `tests/access-control.test.ts` |
| n8n request notification on creation and every status change | Outbox → workflow 01 | N8N-1, N8N-6 |
| n8n daily overdue reminders, with status written back to Convex | Workflow 02, `GET /automation/overdue-loans`, `POST /automation/events` | N8N-2 to N8N-5 |
| HMAC signatures verified in both directions | `convex/lib/signing.ts`, "Verify signature" node | N8N-7, `tests/n8n-signing.test.ts` |
| Secrets in env and n8n credentials, none in code or JSON | `.env*.example`, `n8n/setup/bootstrap.sh` | Secret scan below |
| Idempotent write-backs | `notify:` and `overdue:` keys, n8n dedupe | N8N-5, N8N-6, `tests/automation.test.ts` |
| Retries and an error workflow, no silent failures | Outbox retries and crons, Automation health, workflow 03 | N8N-8, N8N-9, `tests/automation.test.ts` |
| Bonus: automation activity on each loan | `loanActivity` | N8N-4 ("Overdue reminder sent") |
| Repository, workflow JSON, README with setup, env, architecture, security, production notes | `n8n/workflows/`, `docker-compose.yml`, `README.md` | Clean-install verification in the QA report |

## Secret scan

**What was checked:** every file that would be committed, plus the full git history.

**Values.** The real values from the local secret stores were compared against every file: the git-ignored `.env.local` and `.env.n8n`, and the Convex deployment variables. Covered values include:

- the Clerk keys;
- both HMAC secrets;
- the n8n encryption key.

No secret value appears in any file. The only matches were non-secret defaults shared with the example files: local URLs and `.test` email addresses.

**Patterns searched:**

- Clerk keys;
- private-key blocks;
- cloud and GitHub tokens;
- JWTs;
- hex strings of 32 characters or more;
- URLs with embedded credentials;
- Convex deploy keys;
- personal email addresses.

There were no matches.

**Workflow exports.** The three exported workflows reference one SMTP credential by id and name only. They contain no `pinData`, static data or instance metadata.

## Known limitations

- **Development instances only.** Clerk was a development instance, and Convex ran locally. No hosted deployment was tested.
- **Some Clerk flows not exercised in a browser.** Sign-out and Clerk sign-up were not run. They are standard Clerk components with no custom code.
- **Multi-user checks used Convex test identities**, not a second Clerk session. They run the same functions and server checks; only Clerk's token verification is skipped.
- **Email went to Mailpit**, so real deliverability was not tested.
