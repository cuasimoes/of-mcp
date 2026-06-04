// OmniJS script to get projects that need review
(() => {
  try {
    const args = typeof injectedArgs !== 'undefined' ? injectedArgs : {};
    const includeOnHold = args.includeOnHold || false;
    const limit = args.limit || 50;

    const now = new Date();

    // Track optional-field read failures instead of swallowing them silently (issue #110)
    const MAX_ERROR_SAMPLES = 3;
    let metadataErrorCount = 0;
    const errorSamples = [];

    // Get project status string
    const statusMap = {
      [Project.Status.Active]: "Active",
      [Project.Status.Done]: "Done",
      [Project.Status.Dropped]: "Dropped",
      [Project.Status.OnHold]: "OnHold"
    };

    // Helper to check if project is effectively dropped (including via container)
    function isEffectivelyDropped(project) {
      // Check direct dropped status
      if (project.status === Project.Status.Dropped) {
        return true;
      }
      // Check if containing folder is dropped ("dropped with container")
      // Note: Use parentFolder property, not folder
      try {
        let folder = project.parentFolder;
        while (folder) {
          if (folder.status === Folder.Status.Dropped) {
            return true;
          }
          folder = folder.parent; // Check parent folders too
        }
      } catch (e) {
        // Intentionally not counted: defensive guard that returns a safe `false`
        // on folder-traversal failure rather than dropping data (issue #110)
      }
      return false;
    }

    // Filter projects that need review
    const projectsNeedingReview = flattenedProjects.filter(project => {
      // Skip completed or dropped projects (including dropped with container)
      if (project.status === Project.Status.Done || isEffectivelyDropped(project)) {
        return false;
      }
      // Skip on-hold projects unless explicitly included
      if (!includeOnHold && project.status === Project.Status.OnHold) {
        return false;
      }
      // Skip projects without a next review date
      if (!project.nextReviewDate) {
        return false;
      }
      // Include if next review date is in the past or today
      return project.nextReviewDate <= now;
    });

    // Sort by next review date (oldest first)
    projectsNeedingReview.sort((a, b) => {
      const dateA = a.nextReviewDate || new Date('9999-12-31');
      const dateB = b.nextReviewDate || new Date('9999-12-31');
      return dateA - dateB;
    });

    // Apply limit
    const limitedProjects = projectsNeedingReview.slice(0, limit);

    // Build result
    const projects = limitedProjects.map(project => {
      let folderId = null;
      let folderName = null;
      try {
        // Use parentFolder, not folder (project.folder is always undefined; issue #110)
        if (project.parentFolder) {
          folderId = project.parentFolder.id.primaryKey;
          folderName = project.parentFolder.name;
        }
      } catch (e) {
        metadataErrorCount++;
        if (errorSamples.length < MAX_ERROR_SAMPLES) {
          errorSamples.push(`folder(${project.name || 'unknown'}): ${e.message || String(e)}`);
        }
      }

      let remainingTaskCount = 0;
      try {
        if (project.flattenedTasks) {
          remainingTaskCount = project.flattenedTasks.filter(
            t => t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped
          ).length;
        }
      } catch (e) {
        metadataErrorCount++;
        if (errorSamples.length < MAX_ERROR_SAMPLES) {
          errorSamples.push(`taskCount(${project.name || 'unknown'}): ${e.message || String(e)}`);
        }
      }

      // Get review interval - ReviewInterval has .steps and .unit properties
      let reviewIntervalSeconds = null;
      try {
        const ri = project.reviewInterval;
        if (ri !== null && ri !== undefined) {
          const steps = ri.steps || 0;
          const unit = ri.unit || 'days';
          if (unit === 'days') reviewIntervalSeconds = steps * 24 * 60 * 60;
          else if (unit === 'weeks') reviewIntervalSeconds = steps * 7 * 24 * 60 * 60;
          else if (unit === 'months') reviewIntervalSeconds = steps * 30 * 24 * 60 * 60;
          else if (unit === 'years') reviewIntervalSeconds = steps * 365 * 24 * 60 * 60;
          else reviewIntervalSeconds = steps;
        }
      } catch (e) {
        metadataErrorCount++;
        if (errorSamples.length < MAX_ERROR_SAMPLES) {
          errorSamples.push(`reviewInterval(${project.name || 'unknown'}): ${e.message || String(e)}`);
        }
      }

      return {
        id: project.id.primaryKey,
        name: project.name,
        status: statusMap[project.status] || "Unknown",
        remainingTaskCount: remainingTaskCount,
        folderId: folderId,
        folderName: folderName,
        reviewInterval: reviewIntervalSeconds,
        nextReviewDate: project.nextReviewDate ? project.nextReviewDate.toISOString() : null,
        lastReviewDate: project.lastReviewDate ? project.lastReviewDate.toISOString() : null
      };
    });

    const result = {
      success: true,
      totalCount: projectsNeedingReview.length,
      returnedCount: projects.length,
      projects: projects
    };
    if (metadataErrorCount > 0) {
      result.processingErrors = { metadataErrors: metadataErrorCount, samples: errorSamples };
    }
    return JSON.stringify(result);

  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Error getting projects for review: ${error}`
    });
  }
})();
