import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Price Tracker · TCGer Demo",
};

export default function DemoPricesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
