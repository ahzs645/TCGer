import type { Metadata, Viewport } from "next";
import { Inter, Lexend } from "next/font/google";
import "./globals.css";

import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SetupGuard } from "@/components/auth/setup-guard";
import { getToken } from "@/lib/auth-server";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const lexend = Lexend({ subsets: ["latin"], variable: "--font-heading" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export const metadata: Metadata = {
  title: "TCGer",
  description: "Unified hub for Yu-Gi-Oh!, Magic, and Pokémon collections.",
  icons: {
    icon: "/logo.svg",
    shortcut: "/logo.svg",
    apple: "/logo.svg"
  }
};

export default async function RootLayout({
  children


}: {children: React.ReactNode;}) {
  const token = await getToken().catch(() => null);

  return (
    <html lang="en" suppressHydrationWarning data-oid="zox-:z5">
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased text-foreground",
          inter.variable,
          lexend.variable
        )}
        data-oid="4lnnwrh">

        <ConvexClientProvider initialToken={token} data-oid=".wkkdfy">
          <ThemeProvider data-oid="jr5d..d">
            <QueryProvider data-oid="iu_0g7w">
              <SetupGuard data-oid="6n258ug">{children}</SetupGuard>
            </QueryProvider>
          </ThemeProvider>
        </ConvexClientProvider>

        <script
          src="/onlook-preload-script.js"
          type="module"
          id="onlook-preload-script"
          data-oid="h45ax8c">
        </script>
      </body>
    </html>);

}