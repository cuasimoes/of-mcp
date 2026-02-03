// Batch filter tasks across multiple projects in a single call
(() => {
  try {
    const args = typeof injectedArgs !== 'undefined' ? injectedArgs : {};

    // Error tracking - count errors instead of silently swallowing them
    let filterErrorCount = 0;
    let serializationErrorCount = 0;
    let projectErrorCount = 0;
    const errorSamples = [];
    const MAX_ERROR_SAMPLES = 3;

    const projectIds = args.projectIds || [];
    const projectNames = args.projectNames || [];
    const taskStatus = args.taskStatus || null;
    const flagged = args.flagged !== undefined ? args.flagged : null;
    // Due date filters
    const dueToday = args.dueToday || false;
    const dueThisWeek = args.dueThisWeek || false;
    const dueThisMonth = args.dueThisMonth || false;
    const dueBefore = args.dueBefore || null;
    const dueAfter = args.dueAfter || null;
    const overdue = args.overdue || false;

    // Defer date filters
    const deferToday = args.deferToday || false;
    const deferThisWeek = args.deferThisWeek || false;
    const deferBefore = args.deferBefore || null;
    const deferAfter = args.deferAfter || null;
    const deferAvailable = args.deferAvailable || false;

    // Planned date filters
    const plannedToday = args.plannedToday || false;
    const plannedThisWeek = args.plannedThisWeek || false;
    const plannedBefore = args.plannedBefore || null;
    const plannedAfter = args.plannedAfter || null;

    // Completion date filters
    const completedToday = args.completedToday || false;
    const completedThisWeek = args.completedThisWeek || false;
    const completedThisMonth = args.completedThisMonth || false;
    const completedBefore = args.completedBefore || null;
    const completedAfter = args.completedAfter || null;

    const limit = args.limit || 100;
    const sortBy = args.sortBy || "name";
    const sortOrder = args.sortOrder || "asc";

    // Determine if we need completed tasks
    const wantsCompletedTasks = completedToday || completedThisWeek ||
                                completedThisMonth || completedBefore || completedAfter;

    // formatDate and taskStatusMap are provided by sharedUtils.js

    function getTaskStatus(status) {
      return taskStatusMap[status] || "Unknown";
    }

    function isToday(date) {
      if (!date) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const checkDate = new Date(date);
      return checkDate >= today && checkDate < tomorrow;
    }

    function isThisWeek(date) {
      if (!date) return false;
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      const checkDate = new Date(date);
      return checkDate >= startOfWeek && checkDate < endOfWeek;
    }

    function isOverdue(date) {
      if (!date) return false;
      const now = new Date();
      return new Date(date) < now;
    }

    function isThisMonth(date) {
      if (!date) return false;
      const now = new Date();
      const checkDate = new Date(date);
      return checkDate.getMonth() === now.getMonth() &&
             checkDate.getFullYear() === now.getFullYear();
    }

    // Build project lookup maps (only actual projects, not action groups)
    const projectsById = new Map();
    const projectsByNameLower = new Map();
    flattenedProjects.forEach(p => {
      // Skip action groups - they have IDs with dots like "abc123.14"
      // Real project IDs don't have dots
      if (p.id.primaryKey.includes('.')) {
        return;
      }
      projectsById.set(p.id.primaryKey, p);
      // Store by lowercase name for case-insensitive matching
      const nameLower = p.name.toLowerCase();
      if (!projectsByNameLower.has(nameLower)) {
        projectsByNameLower.set(nameLower, []);
      }
      projectsByNameLower.get(nameLower).push(p);
    });

    // Resolve projects to filter
    const projectsToFilter = [];
    const notFound = [];

    // Add projects by ID
    for (const id of projectIds) {
      const project = projectsById.get(id);
      if (project) {
        projectsToFilter.push(project);
      } else {
        notFound.push(`ID: ${id}`);
      }
    }

    // Add projects by name (partial match)
    for (const name of projectNames) {
      const nameLower = name.toLowerCase();
      let found = false;

      // Try exact match first
      if (projectsByNameLower.has(nameLower)) {
        projectsByNameLower.get(nameLower).forEach(p => {
          if (!projectsToFilter.some(existing => existing.id.primaryKey === p.id.primaryKey)) {
            projectsToFilter.push(p);
            found = true;
          }
        });
      }

      // Try partial match
      if (!found) {
        for (const [key, projects] of projectsByNameLower) {
          if (key.includes(nameLower)) {
            projects.forEach(p => {
              if (!projectsToFilter.some(existing => existing.id.primaryKey === p.id.primaryKey)) {
                projectsToFilter.push(p);
                found = true;
              }
            });
          }
        }
      }

      if (!found) {
        notFound.push(`Name: "${name}"`);
      }
    }

    // Process each project
    const projectResults = [];

    for (const project of projectsToFilter) {
      // Get tasks for this project
      let tasks = [];
      try {
        // Get all tasks in project (including from nested action groups)
        const projectTasks = project.flattenedTasks || [];

        // Filter tasks
        tasks = projectTasks.filter(task => {
          try {
            const status = getTaskStatus(task.taskStatus);

            // Completed tasks logic
            if (wantsCompletedTasks) {
              if (status !== "Completed") {
                return false;
              }
            } else {
              // Exclude completed/dropped unless explicitly requested via taskStatus
              if (status === "Completed" || status === "Dropped") {
                if (!taskStatus || !taskStatus.includes(status)) {
                  return false;
                }
              }
            }

            // Status filter
            if (taskStatus && taskStatus.length > 0) {
              if (!taskStatus.includes(status)) {
                return false;
              }
            }

            // Flagged filter
            if (flagged !== null && task.flagged !== flagged) {
              return false;
            }

            // Completion date filters
            if (wantsCompletedTasks) {
              if (completedToday && !isToday(task.completionDate)) {
                return false;
              }
              if (completedThisWeek && !isThisWeek(task.completionDate)) {
                return false;
              }
              if (completedThisMonth && !isThisMonth(task.completionDate)) {
                return false;
              }
              if (completedBefore) {
                if (!task.completionDate) return false;
                if (new Date(task.completionDate) >= new Date(completedBefore)) return false;
              }
              if (completedAfter) {
                if (!task.completionDate) return false;
                if (new Date(task.completionDate) <= new Date(completedAfter)) return false;
              }
            }

            // Planned date filters
            if (plannedToday && !isToday(task.plannedDate)) {
              return false;
            }
            if (plannedThisWeek && !isThisWeek(task.plannedDate)) {
              return false;
            }
            if (plannedBefore) {
              if (!task.plannedDate) return false;
              if (new Date(task.plannedDate) >= new Date(plannedBefore)) return false;
            }
            if (plannedAfter) {
              if (!task.plannedDate) return false;
              if (new Date(task.plannedDate) <= new Date(plannedAfter)) return false;
            }

            // Due date filters
            if (dueToday && !isToday(task.dueDate)) {
              return false;
            }
            if (dueThisWeek && !isThisWeek(task.dueDate)) {
              return false;
            }
            if (dueThisMonth && !isThisMonth(task.dueDate)) {
              return false;
            }
            if (overdue && !isOverdue(task.dueDate)) {
              return false;
            }
            if (dueBefore) {
              if (!task.dueDate) return false;
              if (new Date(task.dueDate) >= new Date(dueBefore)) return false;
            }
            if (dueAfter) {
              if (!task.dueDate) return false;
              if (new Date(task.dueDate) <= new Date(dueAfter)) return false;
            }

            // Defer date filters
            if (deferToday && !isToday(task.deferDate)) {
              return false;
            }
            if (deferThisWeek && !isThisWeek(task.deferDate)) {
              return false;
            }
            if (deferBefore) {
              if (!task.deferDate) return false;
              if (new Date(task.deferDate) >= new Date(deferBefore)) return false;
            }
            if (deferAfter) {
              if (!task.deferDate) return false;
              if (new Date(task.deferDate) <= new Date(deferAfter)) return false;
            }
            if (deferAvailable) {
              if (!task.deferDate) return false;
              if (new Date(task.deferDate) > new Date()) return false;
            }

            return true;
          } catch (e) {
            filterErrorCount++;
            if (errorSamples.length < MAX_ERROR_SAMPLES) {
              errorSamples.push('Filter in "' + project.name + '": ' + e);
            }
            return false;
          }
        });
      } catch (e) {
        projectErrorCount++;
        if (errorSamples.length < MAX_ERROR_SAMPLES) {
          errorSamples.push('Project "' + project.name + '": ' + e);
        }
        projectResults.push({
          projectId: project.id.primaryKey,
          projectName: project.name,
          error: 'Failed to access tasks: ' + e,
          taskCount: 0,
          totalCount: 0,
          tasks: []
        });
      }

      // Sort tasks
      if (sortBy === "dueDate") {
        tasks.sort((a, b) => {
          const dateA = a.dueDate || new Date('2099-12-31');
          const dateB = b.dueDate || new Date('2099-12-31');
          return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
        });
      } else if (sortBy === "deferDate") {
        tasks.sort((a, b) => {
          const dateA = a.deferDate || new Date('2099-12-31');
          const dateB = b.deferDate || new Date('2099-12-31');
          return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
        });
      } else if (sortBy === "plannedDate") {
        tasks.sort((a, b) => {
          const dateA = a.plannedDate || new Date('2099-12-31');
          const dateB = b.plannedDate || new Date('2099-12-31');
          return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
        });
      } else if (sortBy === "completedDate") {
        tasks.sort((a, b) => {
          const dateA = a.completionDate || new Date('1900-01-01');
          const dateB = b.completionDate || new Date('1900-01-01');
          return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
        });
      } else if (sortBy === "flagged") {
        tasks.sort((a, b) => {
          if (a.flagged === b.flagged) return 0;
          if (sortOrder === "desc") {
            return a.flagged ? -1 : 1;
          }
          return a.flagged ? 1 : -1;
        });
      } else {
        // Default: sort by name
        tasks.sort((a, b) => {
          const nameA = a.name || '';
          const nameB = b.name || '';
          if (nameA < nameB) return sortOrder === "desc" ? 1 : -1;
          if (nameA > nameB) return sortOrder === "desc" ? -1 : 1;
          return 0;
        });
      }

      const totalCount = tasks.length;

      // Apply limit
      if (limit && tasks.length > limit) {
        tasks = tasks.slice(0, limit);
      }

      // Format task data
      const taskData = tasks.map(task => {
        try {
          return {
            id: task.id.primaryKey,
            name: task.name,
            note: task.note || "",
            taskStatus: getTaskStatus(task.taskStatus),
            flagged: task.flagged,
            dueDate: formatDate(task.dueDate),
            deferDate: formatDate(task.deferDate),
            plannedDate: formatDate(task.plannedDate),
            completedDate: formatDate(task.completionDate),
            estimatedMinutes: task.estimatedMinutes,
            createdDate: formatDate(task.added),
            tags: task.tags.map(tag => ({
              id: tag.id.primaryKey,
              name: tag.name
            }))
          };
        } catch (e) {
          serializationErrorCount++;
          if (errorSamples.length < MAX_ERROR_SAMPLES) {
            errorSamples.push('Serialize in "' + project.name + '": ' + e);
          }
          return null;
        }
      }).filter(t => t !== null);

      projectResults.push({
        projectId: project.id.primaryKey,
        projectName: project.name,
        taskCount: taskData.length,
        totalCount: totalCount,
        tasks: taskData
      });
    }

    const response = {
      success: true,
      projectResults: projectResults,
      notFound: notFound,
      totalProjects: projectResults.length,
      totalTasks: projectResults.reduce((sum, p) => sum + p.taskCount, 0)
    };

    if (filterErrorCount > 0 || serializationErrorCount > 0 || projectErrorCount > 0) {
      response.processingErrors = {
        filterErrors: filterErrorCount,
        serializationErrors: serializationErrorCount,
        projectErrors: projectErrorCount,
        samples: errorSamples
      };
    }

    return JSON.stringify(response);

  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Error in batch filter: ${error}`
    });
  }
})();
