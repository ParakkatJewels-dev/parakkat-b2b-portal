'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AuditLogPage } from '@/admin/AuditLogPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <AuditLogPage />
    </ProtectedRoute>
  );
}
