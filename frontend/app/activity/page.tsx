import type { Metadata } from "next";

import { ActivityPage } from "@/components/activity/activity-page";

export const metadata: Metadata = {
  title: "Activity",
  description: "Review notifications and mark account activity as read.",
};

export default function Page() {
  return <ActivityPage />;
}
