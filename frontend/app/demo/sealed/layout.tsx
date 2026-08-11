import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sealed Products · TCGer Demo",
};

export default function DemoSealedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
