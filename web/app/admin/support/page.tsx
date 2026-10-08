'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { SupportPage } from '@/admin/sections/SupportPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <SupportPage />
    </ProtectedRoute>
  );
}
