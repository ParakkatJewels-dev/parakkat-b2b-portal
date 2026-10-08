'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { GuestsPage } from '@/agency/sections/GuestsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <GuestsPage />
    </ProtectedRoute>
  );
}
