import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Safety net for the outbox: re-schedules deliveries whose attempt never ran.
crons.interval("re-deliver stuck notifications", { minutes: 5 }, internal.notifications.sweepStuck, {});

// Flags notifications n8n accepted but never reported a result for.
crons.interval("flag unconfirmed notifications", { minutes: 5 }, internal.notifications.flagUnconfirmed, {});

// Closes requests whose first day passed without an answer, and tells the borrower.
crons.interval("expire unanswered requests", { hours: 1 }, internal.loans.expireUnanswered, {});

export default crons;
