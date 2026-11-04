"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  LIMITS,
  type Category,
  type Condition,
} from "@convex/lib/constants";
import type { Availability } from "@convex/lib/tools";
import { useActions } from "@/lib/useActions";
import { useToday } from "@/lib/useToday";
import { ConfirmButton } from "../ConfirmButton";
import { Badge, Button, Card, EmptyState, ErrorText, Field, inputClass, Loading } from "../ui";
import { AvailabilityBadge } from "./AvailabilityBadge";
import { ToolSummary } from "./ToolSummary";

type ToolDraft = { name: string; category: Category; condition: Condition; description: string };
const EMPTY: ToolDraft = { name: "", category: "power_tools", condition: "good", description: "" };

/** Says what removing a listing will cancel, so nobody's booking disappears unannounced. */
function removalQuestion(tool: { pendingRequests: number; availability: Availability }): string {
  const booked = tool.availability.state === "available" && tool.availability.nextReservedFrom;
  if (booked && tool.pendingRequests > 0) return "Remove it? Open requests and upcoming bookings will be cancelled.";
  if (booked) return "Remove it? Upcoming bookings will be cancelled and the borrowers told.";
  if (tool.pendingRequests > 0) return "Remove it? Open requests will be closed.";
  return "Remove this listing?";
}

export function ListingsTab() {
  const today = useToday();
  const listings = useQuery(api.tools.myListings, today ? { today } : "skip");
  const remove = useMutation(api.tools.remove);
  const { run, isBusy, errorFor } = useActions();
  // Which form is open: a new listing, or the listing being edited.
  const [form, setForm] = useState<"new" | Id<"tools"> | null>(null);

  return (
    <section className="flex flex-col gap-4">
      {form === "new" ? (
        <Card>
          <ToolForm onDone={() => setForm(null)} />
        </Card>
      ) : (
        <div>
          <Button variant="primary" onClick={() => setForm("new")}>
            List a tool
          </Button>
        </div>
      )}
      {listings === undefined ? (
        <Loading />
      ) : listings.length === 0 ? (
        <EmptyState>You haven&apos;t listed anything yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {listings.map((tool) => (
            <li key={tool.id}>
              <Card className="flex flex-col gap-3">
                {form === tool.id ? (
                  <ToolForm toolId={tool.id} initial={tool} onDone={() => setForm(null)} />
                ) : (
                  <>
                    <ToolSummary
                      tool={tool}
                      badges={
                        <>
                          {tool.pendingRequests > 0 && (
                            <Badge tone="warn">
                              {tool.pendingRequests} open request{tool.pendingRequests === 1 ? "" : "s"}
                            </Badge>
                          )}
                          <AvailabilityBadge availability={tool.availability} />
                        </>
                      }
                    />
                    <ErrorText>{errorFor(tool.id)}</ErrorText>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button onClick={() => setForm(tool.id)}>Edit</Button>
                      {tool.availability.state === "available" ? (
                        <ConfirmButton
                          label="Remove"
                          question={removalQuestion(tool)}
                          confirmLabel="Yes, remove"
                          disabled={isBusy(tool.id)}
                          onConfirm={() => run(tool.id, () => remove({ toolId: tool.id }))}
                        />
                      ) : (
                        <span className="text-sm text-muted">Lent out: mark it returned before removing it.</span>
                      )}
                    </div>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ToolForm({
  toolId,
  initial = EMPTY,
  onDone,
}: {
  toolId?: Id<"tools">;
  initial?: ToolDraft;
  onDone: () => void;
}) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const { run, isBusy, errorFor } = useActions();
  const [draft, setDraft] = useState<ToolDraft>({
    name: initial.name,
    category: initial.category,
    condition: initial.condition,
    description: initial.description,
  });
  const saving = isBusy("save");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run("save", () => (toolId ? update({ toolId, ...draft }) : create(draft)));
    if (result.ok) onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Name">
        <input
          required
          maxLength={LIMITS.toolName}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Cordless drill"
          className={inputClass}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category">
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition">
          <select
            value={draft.condition}
            onChange={(e) => setDraft({ ...draft, condition: e.target.value as Condition })}
            className={inputClass}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Short description">
        <textarea
          required
          rows={3}
          maxLength={LIMITS.toolDescription}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="What's included, anything to know before borrowing"
          className={inputClass}
        />
      </Field>
      <ErrorText>{errorFor("save")}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : toolId ? "Save changes" : "List tool"}
        </Button>
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
