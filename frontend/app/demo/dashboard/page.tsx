import { AppShell } from '@/components/layout/app-shell';
import { DashboardContent } from '@/components/dashboard/dashboard-content';

/**
 * Demo dashboard — renders the same dashboard as the root page so that the
 * demo stays inside the /demo/* path.  The GitHub Pages deployment only
 * includes /demo and /_next from the Next.js static export; redirecting to
 * "/" would land on the marketing site instead of the app dashboard.
 */
export default function DemoDashboardPage() {
  return (
    <AppShell>
      <DashboardContent />
    </AppShell>
  );
}
