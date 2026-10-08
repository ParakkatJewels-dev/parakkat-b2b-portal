import path from 'node:path';
import { createApp } from './server/src/app';

const app = createApp({
  clientDistDir: path.join(process.cwd(), 'public'),
  loadSettingsOnRequest: true,
});

export default app;
