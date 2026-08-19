import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sealed Products",
};

export default function SealedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
