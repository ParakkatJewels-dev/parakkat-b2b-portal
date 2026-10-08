import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

const prismaCommand = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
const args = process.argv.slice(2);
const directUrl = process.env.DIRECT_URL?.trim();
const child = spawn(prismaCommand, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: directUrl || process.env.DATABASE_URL,
  },
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
