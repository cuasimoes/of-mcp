import { executeOmniFocusScript } from '../../utils/scriptExecution.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('listTags');

export interface ListTagsOptions {
  includeDropped?: boolean;
  showTaskCounts?: boolean;
}

interface TagInfo {
  id: string;
  name: string;
  active: boolean;
  status: 'active' | 'onHold' | 'dropped';
  taskCount?: number;
  availableTaskCount?: number;
  parent: string | null;
  parentId: string | null;
}

interface ListTagsResult {
  success: boolean;
  count: number;
  tags: TagInfo[];
  error?: string;
}

export async function listTags(options: ListTagsOptions = {}): Promise<string> {
  const { includeDropped = false, showTaskCounts = false } = options;

  try {
    const result = await executeOmniFocusScript('@listTags.js', {
      includeDropped,
      showTaskCounts
    });

    let parsed: ListTagsResult;
    if (typeof result === 'string') {
      parsed = JSON.parse(result);
    } else {
      parsed = result as ListTagsResult;
    }

    if (!parsed.success) {
      throw new Error(parsed.error || 'Unknown error');
    }

    // Format output
    let output = `# 🏷️ ALL TAGS\n\n`;
    output += `Found ${parsed.count} tag${parsed.count === 1 ? '' : 's'}${includeDropped ? ' (including dropped)' : ''}:\n\n`;

    if (parsed.tags.length === 0) {
      output += 'No tags found.\n';
      return output;
    }

    // Group by parent ID (names are not unique) for hierarchical display.
    // A tag whose parent was filtered out (e.g. dropped parent, includeDropped=false)
    // is promoted to top level so every returned tag is rendered.
    const knownIds = new Set(parsed.tags.map(t => t.id));
    const topLevel: TagInfo[] = [];
    const byParent = new Map<string, TagInfo[]>();

    for (const tag of parsed.tags) {
      if (tag.parentId && knownIds.has(tag.parentId)) {
        if (!byParent.has(tag.parentId)) {
          byParent.set(tag.parentId, []);
        }
        byParent.get(tag.parentId)!.push(tag);
      } else {
        topLevel.push(tag);
      }
    }

    // Display tags
    const getStatusDisplay = (status: string) => {
      switch (status) {
        case 'onHold': return ' ⏸️ (on hold)';
        case 'dropped': return ' 🚫 (dropped)';
        default: return '';
      }
    };

    let rendered = 0;
    const renderTag = (tag: TagInfo, depth: number) => {
      rendered++;
      const status = getStatusDisplay(tag.status);
      const tasks = (showTaskCounts && tag.availableTaskCount && tag.availableTaskCount > 0)
        ? ` [${tag.availableTaskCount} available]`
        : '';
      if (depth === 0) {
        // A top-level entry that still has a parentId was promoted because its parent is not in the result.
        const orphan = tag.parentId
          ? (tag.parent ? ` (parent "${tag.parent}" not shown)` : ' (parent not shown)')
          : '';
        output += `• **${tag.name}**${orphan}${status}${tasks} [ID: ${tag.id}]\n`;
      } else {
        output += `${'  '.repeat(depth)}└─ ${tag.name}${status}${tasks} [ID: ${tag.id}]\n`;
      }
      for (const child of byParent.get(tag.id) ?? []) {
        renderTag(child, depth + 1);
      }
    };

    for (const tag of topLevel) {
      renderTag(tag, 0);
    }

    output += `\n📊 **Summary**: ${parsed.count} tags\n`;
    if (rendered < parsed.count) {
      output += `⚠️ ${parsed.count - rendered} tags not rendered (unreachable parent chain)\n`;
    }

    return output;

  } catch (error) {
    log.error('Error in listTags', { error: error instanceof Error ? error.message : String(error) });
    throw new Error(`Failed to list tags: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
