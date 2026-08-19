import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wishlists",
};

export default function WishlistsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
