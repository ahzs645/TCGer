import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Card Explorer",
};

export default function DemoCardsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
