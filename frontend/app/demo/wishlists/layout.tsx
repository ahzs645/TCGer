import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wishlists",
};

export default function DemoWishlistsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
