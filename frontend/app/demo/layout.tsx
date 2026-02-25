import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TCGer Demo',
  description: 'Interactive demo of the TCGer collection manager.'
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
