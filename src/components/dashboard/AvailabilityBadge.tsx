import type { Availability } from "@convex/lib/tools";
import { formatDate } from "@/lib/format";
import { Badge } from "../ui";

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  switch (availability.state) {
    case "available":
      return (
        <Badge tone="accent">
          Available{availability.nextReservedFrom ? ` · booked from ${formatDate(availability.nextReservedFrom)}` : ""}
        </Badge>
      );
    case "on_loan":
      return <Badge tone="warn">On loan until {formatDate(availability.until)}</Badge>;
    case "overdue":
      return <Badge tone="danger">Overdue since {formatDate(availability.dueSince)}</Badge>;
  }
}
