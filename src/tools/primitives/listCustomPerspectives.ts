import { executeOmniFocusScript } from '../../utils/scriptExecution.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('listCustomPerspectives');

export interface ListCustomPerspectivesOptions {
  format?: 'simple' | 'detailed' | 'rules';
}

const RULE_INDENT = '   ';

/**
 * Render one archived filter rule as indented lines. Rules come in three shapes:
 * a `disabledRule` wrapper, a nested group (`aggregateType` + `aggregateRules[]`), or a
 * leaf object whose keys are the rule DSL (see PerspectiveRule).
 */
function renderRule(rule: any, depth: number, disabled = false): string[] {
  const indent = RULE_INDENT + '  '.repeat(depth) + '- ';
  const prefix = disabled ? '[disabled] ' : '';

  if (rule === null || typeof rule !== 'object') {
    return [`${indent}${prefix}${JSON.stringify(rule)}`];
  }
  if ('disabledRule' in rule) {
    return renderRule(rule.disabledRule, depth, true);
  }
  if (Array.isArray(rule.aggregateRules)) {
    const lines = [`${indent}${prefix}${rule.aggregateType ?? 'all'} of:`];
    for (const child of rule.aggregateRules) {
      lines.push(...renderRule(child, depth + 1));
    }
    return lines;
  }
  // A leaf with several keys (e.g. actionDateField + actionDateIsInTheNext) is one rule
  const fields = Object.entries(rule).map(([key, value]) =>
    `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`
  );
  return [`${indent}${prefix}${fields.join(', ')}`];
}

function renderPerspectiveRules(p: any): string {
  if (typeof p.rulesError === 'string') {
    return `${RULE_INDENT}Rules: ⚠️ could not be read: ${p.rulesError}`;
  }
  const lines = [`${RULE_INDENT}Aggregation: ${p.archivedTopLevelFilterAggregation ?? '(none)'}`];
  if (!Array.isArray(p.archivedFilterRules) || p.archivedFilterRules.length === 0) {
    lines.push(`${RULE_INDENT}Rules: none`);
  } else {
    lines.push(`${RULE_INDENT}Rules:`);
    for (const rule of p.archivedFilterRules) {
      lines.push(...renderRule(rule, 0));
    }
  }
  return lines.join('\n');
}

export async function listCustomPerspectives(options: ListCustomPerspectivesOptions = {}): Promise<string> {
  const { format = 'simple' } = options;
  
  try {
    log.debug('Starting listCustomPerspectives script');

    // Execute the list custom perspectives script
    const result = await executeOmniFocusScript('@listCustomPerspectives.js', {});

    log.debug('Script execution complete', { resultType: typeof result });

    // Handle various return types
    let data: any;

    if (typeof result === 'string') {
      log.debug('Result is string, attempting JSON parse');
      try {
        data = JSON.parse(result);
        log.debug('JSON parse successful');
      } catch (parseError) {
        log.error('JSON parse failed', { error: (parseError as Error).message });
        throw new Error(`Failed to parse string result: ${result}`);
      }
    } else if (typeof result === 'object' && result !== null) {
      log.debug('Result is object, using directly');
      data = result;
    } else {
      log.error('Invalid result type', { type: typeof result, value: result });
      throw new Error(`Script returned invalid result type: ${typeof result}, value: ${result}`);
    }

    // Check for errors
    if (!data.success) {
      throw new Error(data.error || 'Unknown error occurred');
    }

    // Format output
    if (data.count === 0) {
      return "📋 **Custom Perspectives**\n\nNo custom perspectives found.";
    }

    if (format === 'simple') {
      // Simple format: show name list only
      const perspectiveNames = data.perspectives.map((p: any) => p.name);
      return `📋 **Custom Perspectives** (${data.count})\n\n${perspectiveNames.map((name: string, index: number) => `${index + 1}. ${name}`).join('\n')}`;
    } else if (format === 'rules') {
      // Rules format: name, identifier, aggregation and rendered filter rules
      const perspectiveRules = data.perspectives.map((p: any, index: number) =>
        `${index + 1}. **${p.name}**\n   🆔 ${p.identifier}\n${renderPerspectiveRules(p)}`
      );
      return `📋 **Custom Perspectives** (${data.count})\n\n${perspectiveRules.join('\n\n')}`;
    } else {
      // Detailed format: show name and identifier
      const perspectiveDetails = data.perspectives.map((p: any, index: number) =>
        `${index + 1}. **${p.name}**\n   🆔 ${p.identifier}`
      );
      return `📋 **Custom Perspectives** (${data.count})\n\n${perspectiveDetails.join('\n\n')}`;
    }

  } catch (error) {
    log.error('Error in listCustomPerspectives', { error: error instanceof Error ? error.message : String(error) });
    return `❌ **Error**: ${error instanceof Error ? error.message : String(error)}`;
  }
}