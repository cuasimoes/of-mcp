// OmniJS script to add a project
// This avoids AppleScript issues with ISO date parsing and special characters
// Note: parseLocalDate, resolveFolderByName, and getFolderPath are provided by sharedUtils.js
(() => {
  try {
    const args = typeof injectedArgs !== 'undefined' ? injectedArgs : {};

    const projectName = args.name || null;
    const projectNote = args.note || null;
    const dueDate = args.dueDate || null;
    const deferDate = args.deferDate || null;
    const flagged = args.flagged || false;
    const estimatedMinutes = args.estimatedMinutes || null;
    const tagNames = args.tags || [];
    const folderName = args.folderName || null;
    const folderId = args.folderId || null;
    const sequential = args.sequential || false;

    if (!projectName) {
      return JSON.stringify({
        success: false,
        error: "Project name is required"
      });
    }

    // Determine the container for the new project
    let container = null;

    if (folderId || folderName) {
      const allFolders = flattenedFolders;

      // Try ID lookup first
      if (folderId) {
        for (const folder of allFolders) {
          if (folder.id.primaryKey === folderId) {
            container = folder;
            break;
          }
        }
      }

      // Fall back to name lookup (supports "Parent > Child" paths)
      if (!container && folderName) {
        container = resolveFolderByName(folderName, allFolders);
      }

      if (!container) {
        const searchRef = folderId ? `ID "${folderId}"` : `name "${folderName}"`;
        return JSON.stringify({
          success: false,
          error: `Folder not found with ${searchRef}`
        });
      }
    }

    // Resolve tag references (ID / "Parent > Child" path / active name) before
    // creating anything so an unresolvable reference fails without a stray project
    let resolvedTags = [];
    let tagWarnings = [];
    if (tagNames && tagNames.length > 0) {
      const tagResolution = resolveTagRefs(tagNames, { createIfMissing: true });
      if (tagResolution.errors.length > 0) {
        return JSON.stringify({
          success: false,
          error: tagResolution.errors.join('; ')
        });
      }
      resolvedTags = tagResolution.tags;
      tagWarnings = tagResolution.warnings;
    }

    // Create the new project
    let newProject;
    if (container) {
      newProject = new Project(projectName, container);
    } else {
      newProject = new Project(projectName);
    }

    // Set project properties
    if (projectNote) {
      newProject.note = projectNote;
    }

    // Set due date - parseLocalDate handles date-only strings correctly
    if (dueDate) {
      newProject.dueDate = parseLocalDate(dueDate);
    }

    // Set defer date
    if (deferDate) {
      newProject.deferDate = parseLocalDate(deferDate);
    }

    // Set flagged
    if (flagged) {
      newProject.flagged = true;
    }

    // Set estimated minutes
    if (estimatedMinutes) {
      newProject.estimatedMinutes = estimatedMinutes;
    }

    // Set sequential
    newProject.sequential = sequential;

    // Add tags
    for (const tag of resolvedTags) {
      newProject.addTag(tag);
    }

    const result = {
      success: true,
      projectId: newProject.id.primaryKey,
      name: newProject.name
    };
    if (tagWarnings.length > 0) {
      result.warnings = tagWarnings;
    }
    return JSON.stringify(result);

  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Error adding project: ${error}`
    });
  }
})();
