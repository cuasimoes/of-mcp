// OmniJS script to find a task by ID or name
// This avoids AppleScript escaping issues with special characters like $
(() => {
  try {
    const args = typeof injectedArgs !== 'undefined' ? injectedArgs : {};
    const taskId = args.taskId || null;
    const taskName = args.taskName || null;

    // Track optional-field read failures instead of swallowing them silently (issue #110)
    const MAX_ERROR_SAMPLES = 3;
    let metadataErrorCount = 0;
    const errorSamples = [];

    if (!taskId && !taskName) {
      return JSON.stringify({
        success: false,
        error: "Either taskId or taskName must be provided"
      });
    }

    // Get all flattened tasks
    const allTasks = flattenedTasks;
    let foundTask = null;

    // Search by ID first (most reliable)
    if (taskId) {
      for (const task of allTasks) {
        if (task.id.primaryKey === taskId) {
          foundTask = task;
          break;
        }
      }
    }

    // If not found by ID, search by name (exact match)
    if (!foundTask && taskName) {
      for (const task of allTasks) {
        if (task.name === taskName) {
          foundTask = task;
          break;
        }
      }
    }

    if (!foundTask) {
      return JSON.stringify({
        success: false,
        error: "Task not found"
      });
    }

    // Build task info
    const taskInfo = {
      id: foundTask.id.primaryKey,
      name: foundTask.name,
      note: foundTask.note || "",
      completed: foundTask.taskStatus === Task.Status.Completed,
      dropped: foundTask.taskStatus === Task.Status.Dropped,
      flagged: foundTask.flagged,
      dueDate: foundTask.dueDate ? foundTask.dueDate.toISOString() : null,
      deferDate: foundTask.deferDate ? foundTask.deferDate.toISOString() : null,
      plannedDate: foundTask.plannedDate ? foundTask.plannedDate.toISOString() : null,
      estimatedMinutes: foundTask.estimatedMinutes || null,
      createdDate: foundTask.added ? foundTask.added.toISOString() : null,
      children: [],
      hasChildren: false,
      childrenCount: 0,
      parentId: null,
      parentName: null,
      projectId: null,
      projectName: null,
      tags: [],
      repetitionRule: foundTask.repetitionRule ? foundTask.repetitionRule.toString() : null,
      isRepeating: foundTask.repetitionRule !== null
    };

    // Build children list (one level of direct subtasks)
    try {
      if (foundTask.children && foundTask.children.length > 0) {
        taskInfo.children = foundTask.children.map(child => ({
          id: child.id.primaryKey,
          name: child.name,
          completed: child.taskStatus === Task.Status.Completed,
          dropped: child.taskStatus === Task.Status.Dropped,
          flagged: child.flagged,
          dueDate: child.dueDate ? child.dueDate.toISOString() : null,
          deferDate: child.deferDate ? child.deferDate.toISOString() : null,
          hasChildren: child.hasChildren,
          childrenCount: child.children ? child.children.length : 0
        }));
      }
    } catch (e) {
      taskInfo.childrenError = `Could not load subtasks: ${e}`;
    }
    // Source hasChildren/childrenCount from the task itself rather than the built list,
    // so a subtask-load failure leaves children:[] + childrenError set without making a
    // task that has children report as childless.
    taskInfo.hasChildren = foundTask.hasChildren;
    taskInfo.childrenCount = foundTask.children ? foundTask.children.length : 0;

    // Get parent info. A top-level task's parent is the project's root task
    // (whose .project is truthy); only report a genuine subtask's parent here.
    try {
      if (foundTask.parent && !foundTask.parent.project) {
        taskInfo.parentId = foundTask.parent.id.primaryKey;
        taskInfo.parentName = foundTask.parent.name;
      }
    } catch (e) {
      metadataErrorCount++;
      if (errorSamples.length < MAX_ERROR_SAMPLES) {
        errorSamples.push(`parent(${foundTask.name || 'unknown'}): ${e.message || String(e)}`);
      }
    }

    // Get project info
    try {
      if (foundTask.containingProject) {
        taskInfo.projectId = foundTask.containingProject.id.primaryKey;
        taskInfo.projectName = foundTask.containingProject.name;
      }
    } catch (e) {
      metadataErrorCount++;
      if (errorSamples.length < MAX_ERROR_SAMPLES) {
        errorSamples.push(`project(${foundTask.name || 'unknown'}): ${e.message || String(e)}`);
      }
    }

    // Get tags
    try {
      if (foundTask.tags && foundTask.tags.length > 0) {
        taskInfo.tags = foundTask.tags.map(tag => ({
          id: tag.id.primaryKey,
          name: tag.name
        }));
      }
    } catch (e) {
      metadataErrorCount++;
      if (errorSamples.length < MAX_ERROR_SAMPLES) {
        errorSamples.push(`tags(${foundTask.name || 'unknown'}): ${e.message || String(e)}`);
      }
    }

    const result = {
      success: true,
      task: taskInfo
    };
    if (metadataErrorCount > 0) {
      result.processingErrors = { metadataErrors: metadataErrorCount, samples: errorSamples };
    }
    return JSON.stringify(result);

  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Error finding task: ${error}`
    });
  }
})();
