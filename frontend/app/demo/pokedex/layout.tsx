import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pokédex",
  description: "Explore National Pokédex card completion in the TCGer demo.",
};

export default function DemoPokedexLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
