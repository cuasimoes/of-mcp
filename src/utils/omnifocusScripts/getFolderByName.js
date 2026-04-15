// OmniJS script to find a folder by ID or name
(() => {
  try {
    const args = typeof injectedArgs !== 'undefined' ? injectedArgs : {};
    const folderId = args.folderId || null;
    const folderName = args.folderName || null;

    if (!folderId && !folderName) {
      return JSON.stringify({
        success: false,
        error: "Either folderId or folderName must be provided"
      });
    }

    // Get all flattened folders
    const allFolders = flattenedFolders;
    let foundFolder = null;

    // Search by ID first (most reliable)
    if (folderId) {
      for (const folder of allFolders) {
        if (folder.id.primaryKey === folderId) {
          foundFolder = folder;
          break;
        }
      }
    }

    // If not found by ID, search by name (supports "Parent > Child" paths)
    if (!foundFolder && folderName) {
      foundFolder = resolveFolderByName(folderName, allFolders);
    }

    if (!foundFolder) {
      return JSON.stringify({
        success: false,
        error: "Folder not found"
      });
    }

    // Get folder status string
    const statusMap = {
      [Folder.Status.Active]: "Active",
      [Folder.Status.Dropped]: "Dropped"
    };

    // Build folder info
    const folderInfo = {
      id: foundFolder.id.primaryKey,
      name: foundFolder.name,
      status: statusMap[foundFolder.status] || "Unknown",
      projectCount: 0,
      activeProjectCount: 0,
      subfolderCount: 0,
      parentFolderId: null,
      parentFolderName: null
    };

    // Get project counts
    try {
      if (foundFolder.projects) {
        folderInfo.projectCount = foundFolder.projects.length;
        folderInfo.activeProjectCount = foundFolder.projects.filter(
          p => p.status === Project.Status.Active
        ).length;
      }
    } catch (e) {
      // Project count not accessible
    }

    // Get subfolder count
    try {
      if (foundFolder.folders) {
        folderInfo.subfolderCount = foundFolder.folders.length;
      }
    } catch (e) {
      // Subfolder count not accessible
    }

    // Get parent folder info and full path
    try {
      if (foundFolder.parent && foundFolder.parent.folder) {
        folderInfo.parentFolderId = foundFolder.parent.id.primaryKey;
        folderInfo.parentFolderName = foundFolder.parent.name;
      }
    } catch (e) {
      // Parent folder not accessible
    }

    try {
      folderInfo.path = getFolderPath(foundFolder);
    } catch (e) {
      folderInfo.path = foundFolder.name;
    }

    return JSON.stringify({
      success: true,
      folder: folderInfo
    });

  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Error finding folder: ${error}`
    });
  }
})();
