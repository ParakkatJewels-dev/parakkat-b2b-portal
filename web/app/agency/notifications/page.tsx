'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgencyNotificationsPage } from '@/agency/sections/AgencyNotificationsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <AgencyNotificationsPage />
    </ProtectedRoute>
  );
}
