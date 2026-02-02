import { executeOmniFocusScript } from '../../utils/scriptExecution.js';
import { logger } from '../../utils/logger.js';
import { formatDateSafe } from '../../utils/dateUtils.js';

const log = logger.child('batchFilterTasks');

export interface BatchFilterTasksOptions {
  // Project filters
  projectIds?: string[];
  projectNames?: string[];

  // Task status filter
  taskStatus?: string[];

  // Due date filters
  dueToday?: boolean;
  dueThisWeek?: boolean;
  dueThisMonth?: boolean;
  dueBefore?: string;
  dueAfter?: string;
  overdue?: boolean;

  // Defer date filters
  deferToday?: boolean;
  deferThisWeek?: boolean;
  deferBefore?: string;
  deferAfter?: string;
  deferAvailable?: boolean;

  // Planned date filters
  plannedToday?: boolean;
  plannedThisWeek?: boolean;
  plannedBefore?: string;
  plannedAfter?: string;

  // Completion date filters
  completedToday?: boolean;
  completedThisWeek?: boolean;
  completedThisMonth?: boolean;
  completedBefore?: string;
  completedAfter?: string;

  // Other filters
  flagged?: boolean;

  // Output control
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export async function batchFilterTasks(options: BatchFilterTasksOptions = {}): Promise<string> {
  try {
    const {
      limit = 100,
      sortBy = "name",
      sortOrder = "asc"
    } = options;

    log.debug('Executing batch filter for projects', {
      projectIds: options.projectIds || [],
      projectNames: options.projectNames || []
    });

    const result = await executeOmniFocusScript('@batchFilterTasks.js', {
      ...options,
      limit,
      sortBy,
      sortOrder
    });

    if (typeof result === 'string') {
      return result;
    }

    // If result is an object, format it
    if (result && typeof result === 'object') {
      const data = result as any;

      if (data.error) {
        throw new Error(data.error);
      }

      return formatBatchResults(data, options);
    }

    log.error('Unexpected result format', { resultType: typeof result, result });
    throw new Error('Unexpected result format from OmniFocus');

  } catch (error) {
    log.error('Error in batchFilterTasks', { error: error instanceof Error ? error.message : String(error) });
    throw new Error(`Failed to batch filter tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function formatBatchResults(data: any, options: BatchFilterTasksOptions): string {
  let output = `# 🔍 BATCH FILTER RESULTS\n\n`;

  // Show filter summary
  const filterParts: string[] = [];
  if (options.taskStatus && options.taskStatus.length > 0) {
    filterParts.push(`Status: ${options.taskStatus.join(', ')}`);
  }
  if (options.flagged !== undefined) {
    filterParts.push(`Flagged: ${options.flagged ? 'Yes' : 'No'}`);
  }
  if (options.dueToday) filterParts.push('Due: Today');
  else if (options.dueThisWeek) filterParts.push('Due: This Week');
  else if (options.dueThisMonth) filterParts.push('Due: This Month');
  else if (options.overdue) filterParts.push('Due: Overdue');
  if (options.dueBefore) filterParts.push(`Due before: ${options.dueBefore}`);
  if (options.dueAfter) filterParts.push(`Due after: ${options.dueAfter}`);

  if (options.deferAvailable) filterParts.push('Defer: Available');
  else if (options.deferToday) filterParts.push('Defer: Today');
  else if (options.deferThisWeek) filterParts.push('Defer: This Week');
  if (options.deferBefore) filterParts.push(`Defer before: ${options.deferBefore}`);
  if (options.deferAfter) filterParts.push(`Defer after: ${options.deferAfter}`);

  if (options.plannedToday) filterParts.push('Planned: Today');
  else if (options.plannedThisWeek) filterParts.push('Planned: This Week');
  if (options.plannedBefore) filterParts.push(`Planned before: ${options.plannedBefore}`);
  if (options.plannedAfter) filterParts.push(`Planned after: ${options.plannedAfter}`);

  if (options.completedToday) filterParts.push('Completed: Today');
  else if (options.completedThisWeek) filterParts.push('Completed: This Week');
  else if (options.completedThisMonth) filterParts.push('Completed: This Month');
  if (options.completedBefore) filterParts.push(`Completed before: ${options.completedBefore}`);
  if (options.completedAfter) filterParts.push(`Completed after: ${options.completedAfter}`);

  if (filterParts.length > 0) {
    output += `**Common Filters**: ${filterParts.join(' | ')}\n\n`;
  }

  // Summary
  const projectCount = data.projectResults?.length || 0;
  const totalTasks = data.projectResults?.reduce((sum: number, p: any) => sum + (p.taskCount || 0), 0) || 0;
  output += `**Summary**: ${totalTasks} tasks across ${projectCount} projects\n\n`;
  output += `---\n\n`;

  // Results by project
  if (data.projectResults && Array.isArray(data.projectResults)) {
    for (const projectResult of data.projectResults) {
      const projectName = projectResult.projectName || 'Unknown Project';
      const taskCount = projectResult.taskCount || 0;
      const tasks = projectResult.tasks || [];

      output += `## 📁 ${projectName}\n`;
      output += `**ID**: ${projectResult.projectId || 'N/A'} | **Tasks**: ${taskCount}`;
      if (projectResult.totalCount && projectResult.totalCount > taskCount) {
        output += ` (showing ${taskCount} of ${projectResult.totalCount})`;
      }
      output += `\n\n`;

      if (tasks.length === 0) {
        output += `_No matching tasks_\n\n`;
      } else {
        for (const task of tasks) {
          output += formatTask(task);
        }
        output += '\n';
      }
    }

    // Projects not found
    if (data.notFound && data.notFound.length > 0) {
      output += `## ⚠️ Projects Not Found\n`;
      for (const nf of data.notFound) {
        output += `- ${nf}\n`;
      }
      output += '\n';
    }
  }

  return output;
}

function formatTask(task: any): string {
  let output = '';

  const flagSymbol = task.flagged ? '🚩 ' : '';
  const statusEmoji = getStatusEmoji(task.taskStatus);

  output += `${statusEmoji} ${flagSymbol}**${task.name}** [ID: ${task.id}]`;

  // Status if not Available
  if (task.taskStatus && task.taskStatus !== 'Available') {
    output += ` (${task.taskStatus})`;
  }

  // Created date
  const createdDateStr = formatDateSafe(task.createdDate);
  if (createdDateStr) {
    output += ` (created: ${createdDateStr})`;
  }

  output += '\n';

  // Date info
  const dueDateStr = formatDateSafe(task.dueDate);
  if (dueDateStr) {
    const isOverdue = new Date(task.dueDate) < new Date();
    output += `  ${isOverdue ? '⚠️' : '📅'} Due: ${dueDateStr}\n`;
  }

  const deferDateStr = formatDateSafe(task.deferDate);
  if (deferDateStr) {
    output += `  🚀 Defer: ${deferDateStr}\n`;
  }

  const plannedDateStr = formatDateSafe(task.plannedDate);
  if (plannedDateStr) {
    output += `  📋 Planned: ${plannedDateStr}\n`;
  }

  const completedDateStr = formatDateSafe(task.completedDate);
  if (completedDateStr) {
    output += `  ✅ Done: ${completedDateStr}\n`;
  }

  // Tags
  if (task.tags && task.tags.length > 0) {
    const tagNames = task.tags.map((t: any) => t.name).join(', ');
    output += `  🏷 ${tagNames}\n`;
  }

  // Note (truncated)
  if (task.note && task.note.trim()) {
    const truncatedNote = task.note.length > 100 ? task.note.slice(0, 100) + '...' : task.note;
    output += `  📝 ${truncatedNote.trim()}\n`;
  }

  return output;
}

function getStatusEmoji(status: string): string {
  const statusMap: { [key: string]: string } = {
    'Available': '⚪',
    'Next': '🔵',
    'Blocked': '🔴',
    'DueSoon': '🟡',
    'Overdue': '🔴',
    'Completed': '✅',
    'Dropped': '⚫'
  };

  return statusMap[status] || '⚪';
}
