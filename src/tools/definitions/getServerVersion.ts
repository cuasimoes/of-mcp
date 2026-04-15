import { z } from 'zod';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const schema = z.object({});

export async function handler(_args: z.infer<typeof schema>, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) {
  try {
    // Resolve package.json relative to this file.
    // Supports both esbuild bundle (dist/server.js → ../package.json)
    // and tsc output (dist/tools/definitions/*.js → ../../../package.json)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const candidates = [
      join(__dirname, '..', 'package.json'),
      join(__dirname, '..', '..', 'package.json'),
      join(__dirname, '..', '..', '..', 'package.json'),
    ];
    const packageJsonPath = candidates.find(p => existsSync(p));
    if (!packageJsonPath) {
      throw new Error(`package.json not found (searched from ${__dirname})`);
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    const versionInfo = {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      nodeVersion: process.version,
      platform: process.platform
    };

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(versionInfo, null, 2)
      }]
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    return {
      content: [{
        type: "text" as const,
        text: `Error getting server version: ${errorMessage}`
      }],
      isError: true
    };
  }
}
