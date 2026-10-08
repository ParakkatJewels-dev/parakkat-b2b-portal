'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ResortsPage } from '@/admin/sections/ResortsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <ResortsPage />
    </ProtectedRoute>
  );
}
