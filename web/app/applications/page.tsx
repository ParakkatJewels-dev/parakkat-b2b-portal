'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ApplicationsPage } from '@/admin/ApplicationsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN', 'VERIFIER']}>
      <ApplicationsPage />
    </ProtectedRoute>
  );
}
