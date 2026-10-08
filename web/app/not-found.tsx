'use client';

import { Navigate } from '@/lib/router';

// Unknown paths go to the signed-in home (or on to /login), as they did in the single-page app.
export default function NotFound() {
  return <Navigate to="/" replace />;
}
