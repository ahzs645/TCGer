import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trades · TCGer Demo",
};

export default function DemoTradesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
