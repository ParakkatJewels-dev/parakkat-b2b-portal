/**
 * Serves /api/* from this Next.js app by running the portal's Express API in-process.
 *
 * The API (server/, ~150 routes with validation, RBAC, multipart uploads, signed webhooks and PDF
 * responses) is not re-implemented per route: each request is injected into the same Express app
 * the standalone server runs, so every endpoint keeps its exact behaviour and its test suite.
 * Server-only — imported by app/api/[...path]/route.ts.
 */
import type { RequestListener } from 'node:http';
import inject from 'light-my-request';

type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

// Hop-by-hop headers describe one connection; they never cross into another.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']);

let app: Promise<RequestListener> | null = null;

/**
 * The Express app, created once per server instance.
 *
 * Loaded on first request rather than at import: the server's config module validates the
 * environment as soon as it is imported (and exits on failure), which must not happen while
 * `next build` inspects this route.
 */
function expressApp(): Promise<RequestListener> {
  app ??= import('@b2b-portal/server/dist/app.js')
    .then(({ createApp }) => createApp({ loadSettingsOnRequest: true }) as unknown as RequestListener)
    .catch((error: unknown) => {
      app = null;
      throw error;
    });
  return app;
}

/**
 * Forwarding headers are only as trustworthy as the proxy in front of this app. Vercel's edge
 * overwrites them with the real client address; a bare `next start` passes on whatever the client
 * sent. Set TRUST_PROXY_HEADERS=true when self-hosting behind a proxy that overwrites them.
 */
const TRUST_FORWARDING_HEADERS = process.env.VERCEL === '1' || process.env.TRUST_PROXY_HEADERS === 'true';

/**
 * The caller's address, used by Express for per-IP rate limits and the session console. Without a
 * trusted proxy every request shares one address: the limits stay in force (coarser) rather than
 * being sidestepped by a forged header.
 */
function clientAddress(request: Request): string {
  if (!TRUST_FORWARDING_HEADERS) return '127.0.0.1';
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || '127.0.0.1';
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase() as HttpMethod;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    // The address is passed explicitly below; Express does not trust forwarding headers.
    if (name === 'x-forwarded-for' || HOP_BY_HOP.has(name)) return;
    headers[name] = value;
  });

  // Raw bytes, untouched: the Digio and payment webhooks verify signatures over them.
  const payload = method === 'GET' || method === 'HEAD' ? undefined : Buffer.from(await request.arrayBuffer());

  const response = await inject(await expressApp(), {
    method,
    url: `${url.pathname}${url.search}`,
    headers,
    payload,
    remoteAddress: clientAddress(request),
  });

  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, String(item)));
    else responseHeaders.set(name, String(value));
  }

  const bodyless = method === 'HEAD' || response.statusCode === 204 || response.statusCode === 304;
  return new Response(bodyless ? null : new Uint8Array(response.rawPayload), {
    status: response.statusCode,
    headers: responseHeaders,
  });
}
