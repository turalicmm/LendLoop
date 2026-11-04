/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { addDays, todayIso } from "../convex/lib/validation";

export const modules = import.meta.glob("../convex/**/*.ts");

export function setup() {
  return convexTest(schema, modules);
}

export type TestConvex = ReturnType<typeof setup>;

/** Signs in a test user and creates their row, like the app does on load. */
export async function signIn(
  t: TestConvex,
  name: string,
  opts: { admin?: boolean; email?: string; issuer?: string } = {},
) {
  const email = opts.email ?? `${name.toLowerCase()}@example.test`;
  const user = t.withIdentity({
    tokenIdentifier: `${opts.issuer ?? "test"}|${name}`,
    name,
    email,
  });
  const id = await user.mutation(api.users.ensureCurrentUser, {});
  if (opts.admin) {
    await t.run(async (ctx) => ctx.db.patch("users", id, { role: "admin" }));
  }
  return { client: user, id, email };
}

export const today = () => todayIso();
export const tomorrow = () => addDays(todayIso(), 1);
export const inDays = (n: number) => addDays(todayIso(), n);

export async function listDrill(client: Awaited<ReturnType<typeof signIn>>["client"]) {
  return await client.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18V with two batteries.",
  });
}
