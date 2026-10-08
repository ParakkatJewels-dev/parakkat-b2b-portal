'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AdminFinancePage } from '@/admin/sections/AdminFinancePage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <AdminFinancePage />
    </ProtectedRoute>
  );
}
