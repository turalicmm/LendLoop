"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { LoanStatus } from "@convex/lib/constants";
import { formatRange, timeAgo, timeUntil } from "@/lib/format";
import { useActions } from "@/lib/useActions";
import { useToday } from "@/lib/useToday";
import { Badge, Button, Card, EmptyState, ErrorText, Loading } from "../ui";
import { LoanActivity, notificationLabel } from "./LoanActivity";
import { LoanStatusBadge, STATUS_LABELS } from "./LoanStatus";

export function AdminTab() {
  return (
    <div className="flex flex-col gap-8">
      <AutomationHealth />
      <Members />
      <AllLoans />
    </div>
  );
}

/** "Loan now: Cancelled", so an admin can tell whether a notice still makes sense. */
function loanNow(status: LoanStatus | null): string {
  return `Loan now: ${status ? STATUS_LABELS[status] : "deleted"}`;
}

/** One problem in the health panel: what it is, its details (empty ones skipped), and an optional action. */
function HealthRow({
  badge,
  title,
  details,
  action,
  error,
}: {
  badge: ReactNode;
  title: string;
  details: Array<string | null>;
  action?: ReactNode;
  error?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {badge} {title}
          <span className="block text-xs text-muted">{details.filter(Boolean).join(" · ")}</span>
        </span>
        {action}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function AutomationHealth() {
  const today = useToday();
  const health = useQuery(api.admin.automationHealth, today ? { today } : "skip");
  const resend = useMutation(api.admin.resendNotification);
  const { run, isBusy, errorFor } = useActions();
  const [notice, setNotice] = useState<string | null>(null);

  async function resendNotification(outboxId: Id<"outbox">) {
    setNotice(null);
    const result = await run(outboxId, () => resend({ outboxId }));
    if (result.ok && !result.value.sent) {
      setNotice(`Not sent: ${result.value.reason}, so the email would be out of date. It was cleared from the list.`);
    }
  }

  if (health === undefined) return <Loading />;
  const healthy =
    health.notifications.length === 0 && health.retrying.length === 0 && health.reminders.length === 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Automation health</h2>
      <Card className="flex flex-col gap-3 text-sm">
        <p>
          {healthy ? "No failed notifications or reminders." : "Some automations failed and need a look."}{" "}
          <span className="text-muted">
            {health.pendingNotifications}
            {health.pendingCapped ? "+" : ""} notifications waiting to be delivered.
          </span>
        </p>
        {notice && (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        )}
        {health.notifications.map((n) => (
          <HealthRow
            key={n.id}
            badge={
              n.status === "failed" ? <Badge tone="danger">Failed</Badge> : <Badge tone="warn">No result from n8n</Badge>
            }
            title={`${notificationLabel(n.type, n.status)} · ${n.toolName} · ${timeAgo(n.at)}`}
            details={[
              n.status === "unconfirmed"
                ? "Check n8n's executions before re-sending; the email may have gone out."
                : n.error,
              loanNow(n.loanStatus),
            ]}
            action={
              <Button disabled={isBusy(n.id)} onClick={() => resendNotification(n.id)}>
                Resend
              </Button>
            }
            error={errorFor(n.id)}
          />
        ))}
        {health.retrying.map((n) => (
          <HealthRow
            key={n.id}
            badge={<Badge tone="warn">Retrying</Badge>}
            title={`${notificationLabel(n.type, "pending")} · ${n.toolName} · attempt ${n.attempts + 1} ${timeUntil(n.nextAttemptAt)}`}
            details={[n.error, loanNow(n.loanStatus)]}
          />
        ))}
        {health.reminders.map((r) => (
          <HealthRow
            key={r.id}
            badge={<Badge tone="danger">Reminder failed</Badge>}
            title={`Overdue reminder · ${r.toolName} · ${timeAgo(r.at)}`}
            details={[r.error, "tomorrow's run tries again", loanNow(r.loanStatus)]}
          />
        ))}
      </Card>
    </section>
  );
}

function Members() {
  const members = useQuery(api.admin.members);
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const { run, isBusy, errorFor } = useActions();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Members</h2>
      {members === undefined ? (
        <Loading />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Listings</th>
                <th className="px-4 py-2 font-medium">Trusted Lender</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    {m.name} {m.role === "admin" && <Badge>admin</Badge>}
                    <ErrorText>{errorFor(m.id)}</ErrorText>
                  </td>
                  <td className="px-4 py-2 text-muted">{m.email ?? "—"}</td>
                  <td className="px-4 py-2">
                    {m.listings}
                    {m.listingsCapped ? "+" : ""}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Mark ${m.name} as Trusted Lender`}
                      checked={m.trustedLender}
                      disabled={isBusy(m.id)}
                      onChange={(e) => run(m.id, () => setTrusted({ userId: m.id, trusted: e.target.checked }))}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

function AllLoans() {
  const today = useToday();
  const loans = useQuery(api.admin.allLoans, today ? { today } : "skip");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">All loans</h2>
      {loans === undefined ? (
        <Loading />
      ) : loans.length === 0 ? (
        <EmptyState>No loans yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {loans.map((loan) => (
            <li key={loan.id}>
              <Card className="flex flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{loan.toolName}</span>
                  <LoanStatusBadge status={loan.status} overdue={loan.overdue} />
                </div>
                <span className="text-muted">
                  {loan.lender} → {loan.borrower} · {formatRange(loan.startDate, loan.endDate)}
                </span>
                <LoanActivity items={loan.activity} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
