// Format processing error warnings for display
export function formatProcessingWarnings(processingErrors: any): string {
  if (!processingErrors) return '';
  const filterErrors = processingErrors.filterErrors || 0;
  const serializationErrors = processingErrors.serializationErrors || 0;
  const totalErrors = filterErrors + serializationErrors;
  if (totalErrors === 0) return '';

  let output = `⚠️ **Processing Warnings**:\n`;
  if (filterErrors > 0) {
    output += `- ${filterErrors} task${filterErrors === 1 ? '' : 's'} excluded due to filter evaluation errors\n`;
  }
  if (serializationErrors > 0) {
    output += `- ${serializationErrors} task${serializationErrors === 1 ? '' : 's'} excluded due to serialization errors\n`;
  }
  if (processingErrors.samples && processingErrors.samples.length > 0) {
    output += `- Samples: ${processingErrors.samples.join('; ')}\n`;
  }
  output += '\n';
  return output;
}
