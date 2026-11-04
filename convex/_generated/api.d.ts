/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as crons from "../crons.js";
import type * as devtools from "../devtools.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_loans from "../lib/loans.js";
import type * as lib_outbox from "../lib/outbox.js";
import type * as lib_signing from "../lib/signing.js";
import type * as lib_tools from "../lib/tools.js";
import type * as lib_validation from "../lib/validation.js";
import type * as loans from "../loans.js";
import type * as notifications from "../notifications.js";
import type * as reminders from "../reminders.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  crons: typeof crons;
  devtools: typeof devtools;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/errors": typeof lib_errors;
  "lib/limits": typeof lib_limits;
  "lib/loans": typeof lib_loans;
  "lib/outbox": typeof lib_outbox;
  "lib/signing": typeof lib_signing;
  "lib/tools": typeof lib_tools;
  "lib/validation": typeof lib_validation;
  loans: typeof loans;
  notifications: typeof notifications;
  reminders: typeof reminders;
  tools: typeof tools;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
