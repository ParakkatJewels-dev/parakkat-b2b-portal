'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { InventoryPage } from '@/admin/sections/InventoryPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <InventoryPage />
    </ProtectedRoute>
  );
}
