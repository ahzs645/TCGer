import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "evaluate price alerts",
  { minutes: 15 },
  internal.alertsAutomations.evaluateEnabledPage,
  {}
);

crons.daily(
  "capture collection value snapshots",
  { hourUTC: 0, minuteUTC: 15 },
  internal.analytics.scheduleDailySnapshots,
  {}
);

crons.daily(
  "synchronize Yu-Gi-Oh banlists",
  { hourUTC: 8, minuteUTC: 20 },
  internal.banlistSync.syncAll,
  {}
);

export default crons;
