import { LIMITS } from "./constants";
import { fail } from "./errors";

/**
 * Trims, collapses whitespace and enforces a length range. Multiline text
 * (descriptions) keeps its line breaks, with at most one blank line in a row.
 */
export function cleanText(
  value: string,
  field: string,
  { min = 1, max, multiline = false }: { min?: number; max: number; multiline?: boolean },
): string {
  const cleaned = multiline
    ? value
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : value.replace(/\s+/g, " ").trim();
  if (cleaned.length < min) fail("INVALID", `${field} is required.`);
  if (cleaned.length > max) fail("INVALID", `${field} must be at most ${max} characters.`);
  return cleaned;
}

export function optionalText(
  value: string | undefined,
  field: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return undefined;
  return cleanText(cleaned, field, { max });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Queries take "today" as an argument instead of reading the clock, so
 * results stay cacheable and update when the client's day changes.
 */
export function requireIsoDate(value: string, field = "Date"): string {
  if (!isIsoDate(value)) fail("INVALID", `${field} must be a calendar date (YYYY-MM-DD).`);
  return value;
}

/** Today's UTC calendar date. Loan dates are whole UTC days. */
export function todayIso(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS,
  );
}

/** Validates a requested borrowing window against today's date. */
export function validateLoanRange(
  startDate: string,
  endDate: string,
  today: string,
): void {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    fail("INVALID", "Dates must be valid calendar dates (YYYY-MM-DD).");
  }
  if (startDate < today) fail("INVALID", "The start date can't be in the past.");
  if (endDate < startDate) fail("INVALID", "The end date must be on or after the start date.");
  if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
    fail("INVALID", `A loan can last at most ${LIMITS.maxLoanDays} days.`);
  }
  if (daysBetween(today, startDate) > LIMITS.maxDaysAhead) {
    fail("INVALID", `You can request at most ${LIMITS.maxDaysAhead} days ahead.`);
  }
}

// Looks like a link: a scheme, "www.", or a word ending in a common TLD.
const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|info|io|co|app|xyz|link|click|top|ru|cn)\b/i;

/** True if text contains something an email client would show as a link. */
export function hasLink(text: string): boolean {
  return LINK.test(text);
}

/**
 * A person's name as other people see it, in the app and in emails. Only
 * letters, spaces, hyphens, apostrophes and periods survive, and link-like
 * words are dropped, so nobody can sign up as "https://evil.example/login"
 * and have LendLoop email that to a neighbour. Undefined if nothing is left.
 */
export function displayName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .split(/\s+/)
    .filter((word) => !/[:/@]/.test(word) && !hasLink(word))
    .join(" ")
    .replace(/[^\p{L}\p{M}' .-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return /\p{L}/u.test(cleaned) ? cleaned : undefined;
}

/** First name only: the most we show about one neighbour to another. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Neighbour";
}
