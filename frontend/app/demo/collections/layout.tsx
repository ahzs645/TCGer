import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Collection Sandbox · TCGer Demo",
};

export default function DemoCollectionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
