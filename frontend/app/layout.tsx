import type { Metadata } from 'next';
import { Inter, Lexend } from 'next/font/google';
import './globals.css';

import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { SetupGuard } from '@/components/auth/setup-guard';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const lexend = Lexend({ subsets: ['latin'], variable: '--font-heading' });

export const metadata: Metadata = {
  title: 'TCG Collection Manager',
  description: 'Unified hub for Yu-Gi-Oh!, Magic, and Pokémon collections.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg'
  }
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
          <QueryProvider>
            <SetupGuard>{children}</SetupGuard>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
