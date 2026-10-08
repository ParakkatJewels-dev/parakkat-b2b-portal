'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgencySupportPage } from '@/agency/sections/AgencySupportPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <AgencySupportPage />
    </ProtectedRoute>
  );
}
