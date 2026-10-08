'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgencyAgentsPage } from '@/agency/sections/AgencyAgentsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <AgencyAgentsPage />
    </ProtectedRoute>
  );
}
