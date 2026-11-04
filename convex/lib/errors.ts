import { ConvexError } from "convex/values";

/** The error codes clients can see. Messages are written for people. */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"
  | "RATE_LIMITED";

/** Throws the one kind of error our functions raise: a code and a readable message. */
export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
