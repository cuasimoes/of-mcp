import { z } from 'zod';
import { listCustomPerspectives } from '../primitives/listCustomPerspectives.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';

export const schema = z.object({
  format: z.enum(['simple', 'detailed', 'rules']).optional().describe("Output format: simple (names only), detailed (with identifiers), or rules (identifiers plus each perspective's filter rules and top-level aggregation; a perspective whose rules cannot be read is reported as such) - default: simple")
});

export async function handler(args: z.infer<typeof schema>, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) {
  try {
    const result = await listCustomPerspectives({
      format: args.format || 'simple'
    });
    
    return {
      content: [{
        type: "text" as const,
        text: result
      }]
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    return {
      content: [{
        type: "text" as const,
        text: `Error listing custom perspectives: ${errorMessage}`
      }],
      isError: true
    };
  }
}