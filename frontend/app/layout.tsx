import type { Metadata } from 'next';
import { Inter, Lexend } from 'next/font/google';
import './globals.css';

import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const lexend = Lexend({ subsets: ['latin'], variable: '--font-heading' });

export const metadata: Metadata = {
  title: 'TCG Collection Manager',
  description: 'Unified hub for Yu-Gi-Oh!, Magic, and Pokémon collections.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          'min-h-screen bg-background font-sans antialiased text-foreground',
          inter.variable,
          lexend.variable
        )}
      >
        <ThemeProvider>
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
