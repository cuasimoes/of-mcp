// Format processing error warnings for display.
// Handles three error categories, any combination of which may be present:
//   filterErrors / serializationErrors - tasks dropped during filter/serialize (issue #104/#109)
//   metadataErrors                     - optional fields that could not be read; the item still
//                                        appears but a field falls back to '-', 0, or null (issue #110)
// Shape attached by OmniJS scripts that count optional-field read failures (issue #110).
export interface ProcessingErrors {
  metadataErrors: number;
  samples: string[];
}

export function formatProcessingWarnings(processingErrors: any): string {
  if (!processingErrors) return '';
  const filterErrors = processingErrors.filterErrors || 0;
  const serializationErrors = processingErrors.serializationErrors || 0;
  const metadataErrors = processingErrors.metadataErrors || 0;
  const totalErrors = filterErrors + serializationErrors + metadataErrors;
  if (totalErrors === 0) return '';

  let output = `⚠️ **Processing Warnings**:\n`;
  if (filterErrors > 0) {
    output += `- ${filterErrors} task${filterErrors === 1 ? '' : 's'} excluded due to filter evaluation errors\n`;
  }
  if (serializationErrors > 0) {
    output += `- ${serializationErrors} task${serializationErrors === 1 ? '' : 's'} excluded due to serialization errors\n`;
  }
  if (metadataErrors > 0) {
    output += `- ${metadataErrors} detail${metadataErrors === 1 ? '' : 's'} could not be read; affected fields may show as '-', 0, or null\n`;
  }
  if (processingErrors.samples && processingErrors.samples.length > 0) {
    output += `- Samples: ${processingErrors.samples.join('; ')}\n`;
  }
  output += '\n';
  return output;
}
