import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';

const repoRoot = path.join(__dirname, '..');

// Local runs share the API's configuration (server/.env). On Vercel the dashboard supplies it.
// Existing values are never overridden.
loadDotenv({ path: path.join(repoRoot, 'server', '.env'), quiet: true });

// Public keys keep working under their old Vite names (web/.env, existing Vercel projects).
process.env.NEXT_PUBLIC_SUPABASE_URL ||= process.env.VITE_SUPABASE_URL ?? '';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||=
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

// `npm run dev` runs the API as its own process with hot reload (scripts/dev.mjs) and proxies to
// it. Builds and `next start` serve /api in-process (app/api/[...path]). Set API_IN_PROCESS=1 to
// exercise the in-process path under `next dev` too.
const devApiOrigin =
  process.env.NODE_ENV === 'development' && !process.env.API_IN_PROCESS
    ? process.env.API_DEV_ORIGIN || 'http://localhost:4000'
    : null;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
  // The app imports the compiled API from the sibling workspace.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // The API's compiled code (a workspace, so not in node_modules) is bundled into the route, but
  // libraries that read their own files at runtime must stay plain Node modules: pdfkit (and its
  // fontkit/linebreak data) for every invoice and voucher PDF, Swagger UI for its assets, Prisma
  // for its engine. Bundled, they look for those files under a path that does not exist.
  serverExternalPackages: ['pdfkit', 'swagger-ui-express', 'swagger-jsdoc', '@prisma/client', '.prisma/client'],
  async rewrites() {
    if (!devApiOrigin) return [];
    return { beforeFiles: [{ source: '/api/:path*', destination: `${devApiOrigin}/api/:path*` }] };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
