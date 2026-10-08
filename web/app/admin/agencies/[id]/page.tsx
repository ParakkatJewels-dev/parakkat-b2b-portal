'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgencyDetailPage } from '@/admin/AgencyDetailPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <AgencyDetailPage />
    </ProtectedRoute>
  );
}
