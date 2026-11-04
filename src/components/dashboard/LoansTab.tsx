"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { LoanStatus } from "@convex/lib/constants";
import { formatRange, timeAgo } from "@/lib/format";
import { useActions } from "@/lib/useActions";
import { useToday } from "@/lib/useToday";
import { ConfirmButton } from "../ConfirmButton";
import { Badge, Button, Card, EmptyState, ErrorText, Loading } from "../ui";
import { LoanActivity } from "./LoanActivity";
import { LoanStatusBadge, STATUS_LABELS } from "./LoanStatus";

/** "Approved", "Declined" or "Cancelled", for the "Requested … · Approved …" line. */
function decisionLabel(status: LoanStatus): string {
  return status === "returned" ? "Approved" : STATUS_LABELS[status];
}

/**
 * "My requests" (view = borrower) and "Incoming requests" (view = lender).
 * Which buttons a loan offers comes from the server (`canApprove`,
 * `canDecline`, `canCancel`, `canMarkReturned`), from the same rules the
 * mutations enforce.
 */
export function LoansTab({ view }: { view: "borrower" | "lender" }) {
  const today = useToday();
  const loans = useQuery(view === "borrower" ? api.loans.myRequests : api.loans.incoming, today ? { today } : "skip");
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);
  const { run, isBusy, errorFor } = useActions();

  if (loans === undefined) return <Loading />;
  if (loans.length === 0) {
    return (
      <EmptyState>
        {view === "borrower" ? "You haven't asked to borrow anything yet." : "Nobody has asked to borrow your tools yet."}
      </EmptyState>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {loans.map((loan) => {
          const loanId = loan.id;
          const busy = isBusy(loanId);
          const other = loan.counterparty;
          return (
            <li key={loanId}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {loan.tool.name}
                      {loan.tool.removed && <span className="text-muted"> (removed)</span>}
                    </p>
                    <p className="flex items-center gap-2 text-sm text-muted">
                      {view === "borrower" ? `From ${other.firstName}` : `For ${other.firstName}`}
                      {view === "borrower" && other.trusted && <Badge tone="accent">Trusted Lender</Badge>}
                      <span>· {formatRange(loan.startDate, loan.endDate)}</span>
                    </p>
                  </div>
                  <LoanStatusBadge status={loan.status} overdue={loan.overdue} />
                </div>
                {loan.message && (
                  <p className="rounded-lg bg-background px-3 py-2 text-sm">&ldquo;{loan.message}&rdquo;</p>
                )}
                {other.email && (
                  <p className="text-sm">
                    Arrange the {view === "borrower" ? "pick-up" : "handover"} with {other.firstName}:{" "}
                    <a href={`mailto:${other.email}`} className="text-accent underline">
                      {other.email}
                    </a>
                  </p>
                )}
                <p className="text-xs text-muted">
                  Requested {timeAgo(loan.requestedAt)}
                  {loan.decidedAt !== undefined && loan.status !== "requested" && (
                    <> · {decisionLabel(loan.status)} {timeAgo(loan.decidedAt)}</>
                  )}
                  {loan.returnedAt !== undefined && <> · Returned {timeAgo(loan.returnedAt)}</>}
                </p>
                <LoanActivity items={loan.activity} />
                <ErrorText>{errorFor(loanId)}</ErrorText>
                <div className="flex flex-wrap gap-2">
                  {loan.canApprove && (
                    <Button variant="primary" disabled={busy} onClick={() => run(loanId, () => approve({ loanId }))}>
                      Approve
                    </Button>
                  )}
                  {loan.canDecline && (
                    <Button disabled={busy} onClick={() => run(loanId, () => decline({ loanId }))}>
                      Decline
                    </Button>
                  )}
                  {loan.canMarkReturned && (
                    <Button disabled={busy} onClick={() => run(loanId, () => markReturned({ loanId }))}>
                      Mark as returned
                    </Button>
                  )}
                  {loan.canCancel && (
                    <ConfirmButton
                      label={loan.status === "approved" ? "Cancel booking" : "Cancel request"}
                      question={
                        loan.status === "approved"
                          ? `Cancel this booking? ${other.firstName} will be told.`
                          : "Withdraw this request?"
                      }
                      confirmLabel="Yes, cancel"
                      disabled={busy}
                      onConfirm={() => run(loanId, () => cancel({ loanId }))}
                    />
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
