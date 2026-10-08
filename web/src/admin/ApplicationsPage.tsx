import { AppShell } from '../components/layout/AppShell';
import { ApplicationsQueue } from './ApplicationsQueue';

export function ApplicationsPage() {
  return (
    <AppShell title="eKYC & Documents">
      <ApplicationsQueue />
    </AppShell>
  );
}
