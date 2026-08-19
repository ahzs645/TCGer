import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Price Tracker",
};

export default function PricesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
