import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sealed Products",
};

export default function DemoSealedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
