'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgencyManagementPage } from '@/admin/AgencyManagementPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <AgencyManagementPage />
    </ProtectedRoute>
  );
}
