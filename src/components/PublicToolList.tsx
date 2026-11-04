"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CATEGORY_LABELS, type Category } from "@convex/lib/constants";
import { useToday } from "@/lib/useToday";
import { CategoryFilter } from "./CategoryFilter";
import { EmptyState, Loading } from "./ui";

/** Read-only list for anonymous visitors: tool name and category only. */
export function PublicToolList() {
  const [category, setCategory] = useState<Category | undefined>();
  const today = useToday();
  const tools = useQuery(api.tools.listPublic, today ? { today, category } : "skip");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold">Available right now</h2>
        {tools && (
          <p className="text-sm text-muted">
            {tools.length} {tools.length === 1 ? "tool" : "tools"}
          </p>
        )}
      </div>
      <CategoryFilter value={category} onChange={setCategory} />
      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState>Nothing available in this category yet. Be the first to lend something.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <li key={tool.id} className="rounded-xl border border-line bg-surface px-4 py-3">
              <p className="font-medium">{tool.name}</p>
              <p className="text-sm text-muted">{CATEGORY_LABELS[tool.category]}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
