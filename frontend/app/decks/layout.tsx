import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Decks",
};

export default function DecksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
