'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ReportsPage } from '@/admin/ReportsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <ReportsPage />
    </ProtectedRoute>
  );
}
