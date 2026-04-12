import { executeOmniFocusScript } from '../../utils/scriptExecution.js';
import { queryCache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('getTaskById');

// Interface for task lookup parameters
export interface GetTaskByIdParams {
  taskId?: string;
  taskName?: string;
}

export interface ChildTaskSummary {
  id: string;
  name: string;
  completed: boolean;
  dropped: boolean;
  flagged: boolean;
  dueDate?: string | null;
  deferDate?: string | null;
  hasChildren: boolean;
  childrenCount: number;
}

// Interface for task information result
export interface TaskInfo {
  id: string;
  name: string;
  note: string;
  completed: boolean;
  dropped: boolean;
  flagged: boolean;
  dueDate?: string | null;
  deferDate?: string | null;
  plannedDate?: string | null;
  parentId?: string;
  parentName?: string;
  projectId?: string;
  projectName?: string;
  hasChildren: boolean;
  childrenCount: number;
  children?: ChildTaskSummary[];
  childrenError?: string;
  createdDate?: string | null;
  repetitionRule?: string | null;
  isRepeating?: boolean;
}

/**
 * Get task information by ID or name from OmniFocus
 * Uses OmniJS to avoid AppleScript escaping issues with special characters like $
 */
export async function getTaskById(params: GetTaskByIdParams): Promise<{success: boolean, task?: TaskInfo, error?: string}> {
  try {
    // Validate parameters
    if (!params.taskId && !params.taskName) {
      return {
        success: false,
        error: "Either taskId or taskName must be provided"
      };
    }

    const scriptParams = {
      taskId: params.taskId || null,
      taskName: params.taskName || null
    };

    // Check cache first (getWithChecksum returns checksum for race-condition-free set)
    type CacheResult = {success: boolean, task?: TaskInfo, error?: string};
    const { data: cached, checksum } = await queryCache.getWithChecksum<CacheResult>('getTaskById', scriptParams);
    if (cached) {
      log.debug('Using cached result');
      return cached;
    }

    log.debug('Executing OmniJS script', { taskId: params.taskId, taskName: params.taskName });

    // Execute the OmniJS script
    const result = await executeOmniFocusScript('@getTaskByIdOrName.js', scriptParams);

    // Parse result
    let parsed;
    if (typeof result === 'string') {
      try {
        parsed = JSON.parse(result);
      } catch (e) {
        log.error('Failed to parse result as JSON', { error: (e as Error).message });
        return {
          success: false,
          error: `Failed to parse result: ${result}`
        };
      }
    } else {
      parsed = result;
    }

    let response: CacheResult;
    if (parsed.success) {
      const task = parsed.task as TaskInfo;
      if (!Array.isArray(task.children)) {
        task.children = [];
      }
      response = { success: true, task };
    } else {
      response = { success: false, error: parsed.error || "Unknown error" };
    }

    // Cache the result with the same checksum used for validation
    await queryCache.set('getTaskById', scriptParams, response, checksum);

    return response;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Error in getTaskById', { error: errorMsg });
    return {
      success: false,
      error: errorMsg || "Unknown error in getTaskById"
    };
  }
}
