import { Client, createClient } from '@libsql/client';
import { VercelRequest } from '@vercel/node';

export function getRawBody(request: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const bodyChunks: Buffer[] = [];
    try {
      request
        .on('data', (chunk: Buffer) => {
          bodyChunks.push(chunk);
        })
        .on('end', () => {
          resolve(Buffer.concat(bodyChunks));
        })
        .on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

export function getEnv(name: string, required = true): string {
  const result = process.env[name];
  if (!result) {
    if (required) {
      throw new Error(`${name} is undefined: ${process.env}`);
    }

    return '';
  }
  return result;
}

export function getDB(): Client {
  return createClient({
    url: getEnv('TURSO_URL'),
    authToken: getEnv('TURSO_TOKEN'),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
