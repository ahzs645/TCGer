import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Card Scan",
};

export default function DemoScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
