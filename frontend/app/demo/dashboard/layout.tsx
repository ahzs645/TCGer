import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DemoDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
