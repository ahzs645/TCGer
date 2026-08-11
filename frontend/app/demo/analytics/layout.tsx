import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analytics · TCGer Demo",
};

export default function DemoAnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
