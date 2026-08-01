import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "capture collection value snapshots",
  { hourUTC: 0, minuteUTC: 15 },
  internal.analytics.scheduleDailySnapshots,
  {}
);

export default crons;
