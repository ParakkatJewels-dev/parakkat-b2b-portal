'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgencyBookingsPage } from '@/agency/sections/AgencyBookingsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <AgencyBookingsPage />
    </ProtectedRoute>
  );
}
