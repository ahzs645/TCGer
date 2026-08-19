import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Price Tracker",
};

export default function DemoPricesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
