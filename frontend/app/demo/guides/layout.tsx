import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Collection Guides",
};

export default function DemoGuidesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
