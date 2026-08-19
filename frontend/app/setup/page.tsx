import type { Metadata } from "next";
import { SetupWizard } from "@/components/auth/setup-wizard";

export const metadata: Metadata = {
  title: "Setup",
};

export default function SetupPage() {
  return <SetupWizard data-oid="_q9b9jo" />;
}
