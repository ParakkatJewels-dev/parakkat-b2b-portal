'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { CrsPage } from '@/admin/sections/CrsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <CrsPage />
    </ProtectedRoute>
  );
}
