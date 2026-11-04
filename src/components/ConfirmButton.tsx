"use client";

import { useState } from "react";
import { Button } from "./ui";

/**
 * A button that asks for confirmation inline instead of with window.confirm(),
 * which blocks the page and can't be styled or driven by browser tests.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <Button variant="danger" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span role="group" aria-label={question} className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">{question}</span>
      <Button
        variant="danger"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button autoFocus onClick={() => setAsking(false)}>
        Keep
      </Button>
    </span>
  );
}
