import { handleApiRequest } from '@/server/apiBridge';

// Every /api/* request is answered by the portal's Express API (src/server/apiBridge.ts).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Matches the previous Express function: CRS pushes, PDF builds and cron jobs can run long.
export const maxDuration = 300;

export {
  handleApiRequest as GET,
  handleApiRequest as HEAD,
  handleApiRequest as POST,
  handleApiRequest as PUT,
  handleApiRequest as PATCH,
  handleApiRequest as DELETE,
  handleApiRequest as OPTIONS,
};
