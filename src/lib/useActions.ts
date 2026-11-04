"use client";

import { useCallback, useState } from "react";
import { errorMessage } from "./format";

export type ActionResult<T> = { ok: true; value: T } | { ok: false };

/**
 * Runs a view's actions (mutations), keyed by what they act on (e.g. a row
 * id). Each key has its own busy state, so a row's buttons stay disabled
 * until its own action finishes, and its own error, so a failure is shown
 * next to the row it belongs to.
 */
export function useActions() {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());

  const run = useCallback(async <T,>(key: string, action: () => Promise<T>): Promise<ActionResult<T>> => {
    setErrors((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setBusy((current) => new Set(current).add(key));
    try {
      return { ok: true, value: await action() };
    } catch (e) {
      setErrors((current) => new Map(current).set(key, errorMessage(e)));
      return { ok: false };
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, []);

  return {
    run,
    isBusy: (key: string) => busy.has(key),
    errorFor: (key: string) => errors.get(key) ?? null,
  };
}
