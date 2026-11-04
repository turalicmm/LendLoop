import type { ReactNode } from "react";
import { CATEGORY_LABELS, CONDITION_LABELS, type Category, type Condition } from "@convex/lib/constants";

/** A listing's name, category, condition and description, with its badges on the right. */
export function ToolSummary({
  tool,
  badges,
}: {
  tool: { name: string; category: Category; condition: Condition; description: string };
  badges: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{tool.name}</p>
          <p className="text-sm text-muted">
            {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">{badges}</div>
      </div>
      <p className="whitespace-pre-line text-sm">{tool.description}</p>
    </>
  );
}
