'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgencyReportsPage } from '@/agency/sections/AgencyReportsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <AgencyReportsPage />
    </ProtectedRoute>
  );
}
