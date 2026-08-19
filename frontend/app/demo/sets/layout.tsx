import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set Explorer",
};

export default function DemoSetsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
