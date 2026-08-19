import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardContent } from "@/components/dashboard/dashboard-content";

export const metadata: Metadata = {
  title: "Dashboard · TCGer",
};

export default function DashboardPage() {
  return (
    <AppShell data-oid="o716tbv">
      <DashboardContent data-oid="vz5mbzt" />
    </AppShell>
  );
}
