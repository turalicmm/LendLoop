import type { LoanStatus } from "@convex/lib/constants";
import { Badge, type Tone } from "../ui";

export const STATUS_LABELS: Record<LoanStatus, string> = {
  requested: "Waiting for reply",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  returned: "Returned",
};

const STATUS_TONES: Record<LoanStatus, Tone> = {
  requested: "warn",
  approved: "accent",
  declined: "neutral",
  cancelled: "neutral",
  returned: "neutral",
};

export function LoanStatusBadge({ status, overdue = false }: { status: LoanStatus; overdue?: boolean }) {
  return (
    <span className="flex gap-2">
      {overdue && <Badge tone="danger">Overdue</Badge>}
      <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
    </span>
  );
}
