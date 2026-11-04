import type { LoanEventType } from "@convex/lib/constants";
import type { ActivityItem } from "@convex/lib/loans";
import { timeAgo } from "@/lib/format";

type NotificationState = Extract<ActivityItem, { kind: "notification" }>["status"];

const EMAILS: Record<LoanEventType, string> = {
  "loan.requested": "Request email to the lender",
  "loan.approved": "Approval email to the borrower",
  "loan.declined": "Decline email to the borrower",
  "loan.cancelled": "Cancellation email to the lender",
  "loan.listing_removed": "Listing-removed email to the borrower",
  "loan.returned": "Return confirmation to the borrower",
  "loan.expired": "Expiry email to the borrower",
};

const STATES: Record<NotificationState, string> = {
  pending: "queued",
  sent: "sent",
  failed: "could not be sent",
  unconfirmed: "got no result from n8n",
  resent: "re-sent",
  dismissed: "not re-sent: out of date",
};

/** E.g. "Approval email to the borrower sent". */
export function notificationLabel(type: LoanEventType, status: NotificationState): string {
  return `${EMAILS[type]} ${STATES[status]}`;
}

function activityLabel(item: ActivityItem): string {
  if (item.kind === "reminder") return `Overdue reminder ${item.status === "sent" ? "sent" : "failed"}`;
  return notificationLabel(item.type, item.status);
}

/** Recent automation on a loan, e.g. "Overdue reminder sent · 2 days ago". */
export function LoanActivity({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted">
      {items.map((item, i) => (
        <li key={`${item.kind}-${item.at}-${i}`} className={item.status === "failed" ? "text-danger" : ""}>
          {activityLabel(item)} · {timeAgo(item.at)}
        </li>
      ))}
    </ul>
  );
}
