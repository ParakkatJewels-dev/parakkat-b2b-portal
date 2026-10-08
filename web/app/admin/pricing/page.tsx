'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PricingPage } from '@/admin/sections/PricingPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <PricingPage />
    </ProtectedRoute>
  );
}
