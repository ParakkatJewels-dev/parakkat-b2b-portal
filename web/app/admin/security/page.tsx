'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { SecurityPage } from '@/admin/sections/SecurityPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <SecurityPage />
    </ProtectedRoute>
  );
}
