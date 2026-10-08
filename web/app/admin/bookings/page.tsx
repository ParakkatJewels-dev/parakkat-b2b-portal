'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AdminBookingsPage } from '@/admin/sections/AdminBookingsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <AdminBookingsPage />
    </ProtectedRoute>
  );
}
