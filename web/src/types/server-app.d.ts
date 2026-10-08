// The compiled API (server/dist) has no type declarations of its own; this is the one entry point
// the web app loads from it (src/server/apiBridge.ts).
declare module '@b2b-portal/server/dist/app.js' {
  import type { RequestListener } from 'node:http';

  export function createApp(options?: { loadSettingsOnRequest?: boolean }): RequestListener;
}
