"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS, type Category } from "@convex/lib/constants";
import { addDays } from "@convex/lib/validation";
import { useActions } from "@/lib/useActions";
import { useToday } from "@/lib/useToday";
import { CategoryFilter } from "../CategoryFilter";
import { ConfirmButton } from "../ConfirmButton";
import { Badge, Button, Card, EmptyState, ErrorText, Field, inputClass, Loading } from "../ui";
import { AvailabilityBadge } from "./AvailabilityBadge";
import { ToolSummary } from "./ToolSummary";

export function BrowseTab({ isAdmin }: { isAdmin: boolean }) {
  const [category, setCategory] = useState<Category | undefined>();
  const today = useToday();
  const tools = useQuery(api.tools.list, today ? { today, category } : "skip");
  const remove = useMutation(api.tools.remove);
  const { run, isBusy, errorFor } = useActions();
  // The one card showing a request form, or the "request sent" note after it.
  const [request, setRequest] = useState<{ toolId: Id<"tools">; sent: boolean } | null>(null);

  return (
    <section className="flex flex-col gap-4">
      <CategoryFilter value={category} onChange={setCategory} />
      {tools === undefined || !today ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState>No tools here yet.</EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {tools.map((tool) => {
            const here = request?.toolId === tool.id ? request : null;
            return (
              <li key={tool.id}>
                <Card className="flex h-full flex-col gap-3">
                  <ToolSummary tool={tool} badges={<AvailabilityBadge availability={tool.availability} />} />
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 text-muted">
                      {tool.isMine ? "Your listing" : `Lent by ${tool.lender.firstName}`}
                      {tool.lender.trusted && <Badge tone="accent">Trusted Lender</Badge>}
                    </span>
                    {!tool.isMine && (
                      <span className="flex gap-2">
                        {isAdmin && (
                          <ConfirmButton
                            label="Remove"
                            question="Remove from LendLoop? Open requests and upcoming bookings will be cancelled."
                            confirmLabel="Yes, remove"
                            disabled={isBusy(tool.id)}
                            onConfirm={() => run(tool.id, () => remove({ toolId: tool.id }))}
                          />
                        )}
                        <Button
                          variant="primary"
                          onClick={() => setRequest(here && !here.sent ? null : { toolId: tool.id, sent: false })}
                        >
                          Request to borrow
                        </Button>
                      </span>
                    )}
                  </div>
                  <ErrorText>{errorFor(tool.id)}</ErrorText>
                  {here && !here.sent && (
                    <RequestForm
                      toolId={tool.id}
                      today={today}
                      onCancel={() => setRequest(null)}
                      onSent={() => setRequest({ toolId: tool.id, sent: true })}
                    />
                  )}
                  {here?.sent && (
                    <p role="status" className="text-sm text-accent">
                      Request sent. {tool.lender.firstName} will get an email, and you can follow it in{" "}
                      <Link href="/dashboard?tab=requests" className="underline">
                        My requests
                      </Link>
                      .
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RequestForm({
  toolId,
  today,
  onSent,
  onCancel,
}: {
  toolId: Id<"tools">;
  today: string;
  onSent: () => void;
  onCancel: () => void;
}) {
  const request = useMutation(api.loans.request);
  const { run, isBusy, errorFor } = useActions();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [message, setMessage] = useState("");
  const sending = isBusy("send");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run("send", () => request({ toolId, startDate, endDate, message: message || undefined }));
    if (result.ok) onSent();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input
            type="date"
            required
            min={today}
            max={addDays(today, LIMITS.maxDaysAhead)}
            value={startDate}
            onChange={(e) => {
              const start = e.target.value;
              setStartDate(start);
              // Keep the end inside [start, start + max loan length].
              if (endDate < start || endDate > addDays(start, LIMITS.maxLoanDays - 1)) setEndDate(start);
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Until">
          <input
            type="date"
            required
            min={startDate}
            max={addDays(startDate, LIMITS.maxLoanDays - 1)}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Message (optional)">
        <input
          maxLength={LIMITS.requestMessage}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What do you need it for?"
          className={inputClass}
        />
      </Field>
      <ErrorText>{errorFor("send")}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={sending}>
          {sending ? "Sending…" : "Send request"}
        </Button>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
