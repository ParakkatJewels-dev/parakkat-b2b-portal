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
  // The API runs as plain Node, exactly as the standalone server does: not bundled, so its
  // __dirname-relative files, pdfkit fonts, Prisma engine and Swagger assets resolve as usual.
  serverExternalPackages: ['@b2b-portal/server', '@prisma/client', '.prisma/client'],
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
