import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Transactions",
};

export default function DemoTransactionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
