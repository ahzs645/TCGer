import type { Metadata } from "next";

export const metadata: Metadata = {
  // Own template so demo pages compose as "<page> · TCGer Demo" instead of
  // inheriting the root "· TCGer" suffix on top of their own.
  title: {
    default: "TCGer Demo",
    template: "%s · TCGer Demo",
  },
  description: "Interactive demo of the TCGer collection manager.",
};

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
