import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Card Explorer · TCGer Demo",
};

export default function DemoCardsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
