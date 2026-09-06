// Get all custom perspectives list
// Based on OmniJS API: Perspective.Custom.all

(() => {
  try {
    // Get all custom perspectives
    const customPerspectives = Perspective.Custom.all;

    // Format result
    const perspectives = customPerspectives.map(p => {
      const entry = {
        name: p.name,
        identifier: p.identifier
      };
      // Rules are read per-perspective so one unreadable perspective doesn't
      // hide the rest, and a failure is reported rather than replaced with a
      // default rule set (a plausible wrong answer would defeat the purpose).
      try {
        // Read both before assigning so a throw from the second getter can't
        // leave a half-populated entry alongside rulesError.
        const rules = p.archivedFilterRules;
        const aggregation = p.archivedTopLevelFilterAggregation || null;
        if (!Array.isArray(rules)) {
          entry.rulesError = 'archivedFilterRules returned ' + typeof rules;
        } else {
          entry.archivedFilterRules = rules;
          entry.archivedTopLevelFilterAggregation = aggregation;
        }
      } catch (rulesError) {
        entry.rulesError = rulesError.message || String(rulesError);
      }
      return entry;
    });

    // Return result
    const result = {
      success: true,
      count: perspectives.length,
      perspectives: perspectives
    };

    return JSON.stringify(result);

  } catch (error) {
    // Error handling
    const errorResult = {
      success: false,
      error: error.message || String(error),
      count: 0,
      perspectives: []
    };

    return JSON.stringify(errorResult);
  }
})();
