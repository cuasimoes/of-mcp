# Issue #112 — Phase 1 Diagnostic Findings

**Environment:** of-mcp `v1.30.7`, branch `fix/issue-112-batch-add-sequential-dropped`, OmniFocus 4 Pro on macOS, 2026-04-19.

## Answers

- **Q1** (`add_project` + `folderName` + `sequential: true` at creation): `Active` / `Sequential: Yes`. Does not reproduce D1.
- **Q2 (pre-edit diff)**: No difference in `get_project_by_id` output between `id_a` (add_project, no sequential) and `id_b` (batch_add_items, no sequential). Identical folder, status, task counts, review metadata.
- **Q2 (post-edit)**: Both `id_a` and `id_b` show `Sequential: Yes` after `edit_item newSequential: true`. Setter applied correctly on both.
- **Q3** (`add_project` + later `edit_item newSequential: true`): `id_a` stayed `Active`. Does not reproduce.
- **Known post-edit batch reproducer** (`batch_add_items` no-seq + `edit_item newSequential: true`): `id_b` stayed `Active`. Does not reproduce.
- **Headline creation-time batch reproducer** (`batch_add_items` + `folderName` + `sequential: true` at creation): `Active` / `Sequential: Yes`. Does not reproduce.

## Decision tree output

**No Phase 2 task selected.** D1 is not reproducible in this environment across all four tested variants. Applying `Task 5` / `Task 5b` would be speculative — the fix rationale requires empirical evidence that `project.task.sequential` is the state the UI reads, and no such evidence exists.

## Next steps

Proceed to Phase 3 (D2) and Phase 4 (D3), which are independent of D1 and have their own reproducers. Flag the null D1 result back to issue #112 and request fresh steps-to-reproduce before re-investigating.
