'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ApplicationDetailPage } from '@/admin/ApplicationDetailPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN', 'VERIFIER']}>
      <ApplicationDetailPage />
    </ProtectedRoute>
  );
}
