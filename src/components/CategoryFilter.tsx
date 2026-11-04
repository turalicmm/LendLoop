"use client";

import { CATEGORIES, CATEGORY_LABELS, type Category } from "@convex/lib/constants";

export function CategoryFilter({
  value,
  onChange,
}: {
  value: Category | undefined;
  onChange: (value: Category | undefined) => void;
}) {
  const options: Array<Category | undefined> = [undefined, ...CATEGORIES];
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option ?? "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              active
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-surface text-muted hover:text-foreground"
            }`}
          >
            {option ? CATEGORY_LABELS[option] : "All"}
          </button>
        );
      })}
    </div>
  );
}
