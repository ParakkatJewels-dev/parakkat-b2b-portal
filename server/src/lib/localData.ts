import path from 'node:path';

/**
 * Where local-disk uploads (STORAGE_PROVIDER=local, development only) are kept.
 *
 * Defaults to server/.data next to this code. When the API runs bundled inside the Next.js app
 * (`next start`), module paths are rewritten and no longer point at the repository, so set
 * LOCAL_DATA_DIR there. Deployments use Supabase Storage; nothing here is durable on serverless.
 */
export function localDataDir(): string {
  return process.env.LOCAL_DATA_DIR
    ? path.resolve(process.env.LOCAL_DATA_DIR)
    : path.resolve(__dirname, '../../.data');
}
