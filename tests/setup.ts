import { afterEach, beforeEach, vi } from "vitest";

// convex-test runs scheduled functions (outbox deliveries, follow-up batches)
// on setTimeout. With real timers they run in the background after a test
// ends and leak into the next one. Faking the timers (not Date) for every
// test keeps each test's scheduled work in that test: it runs only when the
// test asks, with `t.finishAllScheduledFunctions(vi.runAllTimers)`.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
});
