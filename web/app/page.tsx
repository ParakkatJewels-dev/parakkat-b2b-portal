'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { RoleHome } from '@/routes/RoleHome';

export default function Page() {
  return (
    <ProtectedRoute>
      <RoleHome />
    </ProtectedRoute>
  );
}
