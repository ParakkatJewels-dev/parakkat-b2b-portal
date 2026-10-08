'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgencyPaymentsPage } from '@/agency/sections/AgencyPaymentsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <AgencyPaymentsPage />
    </ProtectedRoute>
  );
}
