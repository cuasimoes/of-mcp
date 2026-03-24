# Bug: get_custom_perspective_tasks fails when Focus mode is inactive

## Summary
`get_custom_perspective_tasks` throws `undefined is not an object (evaluating 'originalFocus.name')` when OmniFocus Focus mode is not active.

## Version
v1.30.2

## Steps to Reproduce
1. Ensure OmniFocus Focus mode is NOT active (no project/folder/tag focused)
2. Call `get_custom_perspective_tasks` with any perspective name
3. Error occurs regardless of `ignoreFocus` setting

## Error Message
```
❌ **Error**: undefined is not an object (evaluating 'originalFocus.name')
```

## Root Cause
In `getCustomPerspectiveTasks.js` line 17:
```javascript
originalFocus = document.focus;
focusWasActive = originalFocus !== null;
```

The check uses strict inequality (`!==`) against `null`, but `document.focus` returns `undefined` (not `null`) when no Focus mode is active.

Since `undefined !== null` evaluates to `true`, the ternary on lines 18-23 takes the truthy branch and tries to access `originalFocus.name` on `undefined`.

## Fix
Change line 17 to use a nullish check that catches both `null` and `undefined`:

**Option A** (loose equality):
```javascript
focusWasActive = originalFocus != null;  // catches both null AND undefined
```

**Option B** (truthy check):
```javascript
focusWasActive = !!originalFocus;
```

## Affected File
`src/utils/omnifocusScripts/getCustomPerspectiveTasks.js`

## Priority
High - completely breaks the tool when Focus mode is inactive (the common case)

## Discovered
2026-01-22 by Seshat during energy-tasks skill execution
