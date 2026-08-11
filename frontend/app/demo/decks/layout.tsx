import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Decks · TCGer Demo",
};

export default function DemoDecksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
