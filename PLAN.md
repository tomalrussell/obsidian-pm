# Project plan

## Product direction

Markdown tasks with fixed statuses and priorities, shown as a table, a Gantt timeline and a status board. Persistence safeguards stay: queued writes, rename handling, unknown frontmatter preservation and ID repair. Whether to cut a feature is the user's decision. This plan flags complexity and doesn't measure usage.

Removed metadata (recurrence, time tracking, custom fields, assignees and similar) stays in notes as inert frontmatter. Don't delete it on write.

## Current functionality

| Area          | What it does                                                                                           | Where                                          |
| ------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Persistence   | Notes as tasks, YAML frontmatter, wikilinks, rename handling, vault index, queued writes               | `src/store/ProjectStore.ts`, `VaultIndex.ts`   |
| Task model    | Fixed statuses and priorities (`yesterday`, `high`, `medium`, `low`), subtasks, dependencies, milestones, dates, progress, tags | `packages/core/src/types.ts`                   |
| Table         | Sortable, filterable task table with bulk actions, row editing and subtask tree                         | `src/views/table`, `packages/ui`               |
| Gantt         | Task bars, milestones, drag move/resize with undo, dependency linking, cycle checks. Dates are manual.  | `src/views/gantt`, `packages/ui/src/gantt`     |
| Kanban        | Fixed status columns, with column visibility, order and hide-empty controls                            | `src/views/KanbanView.ts`, `packages/ui/src/views` |
| Projects      | Independent projects (no hierarchy), multi-project scopes, overview, dashboard, archive, move, duplicate | `ProjectScope`, `ArchiveOps`, `ProjectOverviewView`, `DashboardView` |
| View state    | Field visibility and order, last-used filters and sorting. No saved or named views.                    | `packages/core/src/store/View*.ts`             |
| Editing       | Task modal and editor, subtasks panel, context menu, note-link suggest, create task from selection    | `src/modals`, `src/ui`                         |
| Import        | Convert existing Markdown notes into tasks                                                             | `ImportModal`                                  |
| Automation    | Auto-archive completed tasks, ID repair, undo/redo of the last action                                  | `src/components`, `ProjectStore`               |
| Support       | Settings, migrations, release notes view, styleguide (dev only)                                        | `src/settings.ts`, `src/migration.ts`          |

Workspace packages: `@dotpm/core` (model, YAML, filtering, dependency graph, view state) and `@dotpm/ui` (DOM primitives, composites, Gantt rendering). The Obsidian plugin in `src` ties them together.

## Where the complexity is

Line counts are approximate.

| Module                             | Lines | Concern                                                                                      |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| `src/store/ProjectStore.ts`        | 1470  | Persistence mixed with import, duplication, moves, archives, attachments and undo            |
| `src/views/ProjectView.ts`         | 1220  | Hosts all three views plus header, filters, scope handling and toolbars. Most likely to hold dead code after the removals |
| `src/store/VaultIndex.ts`          | 500   | Needed. Review only for leftover code from removed features.                                 |
| `src/views/DashboardView.ts`       | 490   | Separate surface from the three core views                                                   |
| `src/views/ProjectOverviewView.ts` | 330   | Same                                                                                         |
| `src/views/styleguide`             | 980   | Dev-only. Production builds already exclude it. Cost is maintenance.                         |
| `src/main.ts`                      | 650   | 14 commands, file-open interception and view registration                                    |

## Dependencies and tooling

| Item                                                     | Role                                       | Suggestion                                                                          |
| -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `obsidian`                                               | Host API, production YAML codec            | Foundational                                                                        |
| `temporal-polyfill`                                      | Date arithmetic                            | Keep                                                                                |
| `monkey-around`                                          | Patches Markdown opening for custom editors | Remove together with automatic editor replacement (step 4)                          |
| `yaml`                                                   | Test-only YAML codec                       | Keep while tests need it. Confirm it isn't bundled.                                 |
| `publint`, `@arethetypeswrong/cli`, `build:packages` script | Checks for publishing npm packages      | Drop if the packages stay private to this repo                                      |
| ESLint (`check:submission`) and oxlint                   | Overlapping lint                           | ESLint is likely needed for `eslint-plugin-obsidianmd` submission rules. Narrow it to those rules and leave the rest to oxlint. |

Manifest declarations alone don't prove a dependency is unused. Grep imports before removing anything.

## Suggested way forward

Ordered by payoff for the effort. Each step is independent, and each is a user decision.

1. **Dead-code sweep (no user-facing change).** Do this first, because the earlier removals left debris.
   - Run an unused-exports pass (`knip` or `ts-prune`) over `src` and `packages`.
   - Check `ProjectView.ts`, `ProjectStore.ts`, `settings.ts`, `styles/` and `packages/ui/src/composites` for orphaned helpers, CSS classes, settings keys and tests.
   - Check `migration.ts` for migrations that only served removed features. Keep any that still protect user data.

2. **Split `ProjectStore`.** This is refactoring, not a feature cut. Move import, duplication, moves, archives and attachments out into modules like `ArchiveOps`. Leave persistence, queued writes and rename handling in the store. The remaining store should be about 600 lines, which makes later cuts cheaper.

3. **Split `ProjectView`.** Pull the per-view toolbar and header logic into the Table, Gantt and Kanban views. The host should only route, scope and hold shared filter state.

4. **Candidate feature cuts, largest first.** Pick any, in any order.
   - Dashboard and project overview: fold what's useful into the project header, or drop them. This removes about 800 lines and one navigation level.
   - Undo/redo outside Gantt: keep Gantt undo only if the command set can shrink.
   - Project duplication and project moving: keep archive only.
   - Import notes as tasks: drop it if tasks are created in the plugin from now on.
   - Automatic Markdown editor replacement: opening a task via the plugin remains. This also removes `monkey-around`.
   - Auto-archiver: replace with the manual archive command.
   - Release notes view: replace with a link to the changelog.
   - Milestones, task dependencies or progress rollups: the model and Gantt both depend on these, so cut only after weighing Gantt's value.
   - Attachments: check whether this is still used anywhere.

5. **Settings and commands audit.** After the cuts, remove settings with only one sensible value, and commands that duplicate UI actions. Aim for fewer than 10 commands.

6. **Packaging and tooling.** Merge the two packages back into `src` if there are no plans to publish them. This removes the workspace, path aliases and build step. Do it last, because it touches every import.

For each cut, cover controls, types, serialization, styles, tests, settings, docs and changelog. Preserve removed metadata as inert frontmatter where practical.

## Milestone redesign

### Target behavior

A milestone is a dated gate that tasks block. It is not a task container.

- **Single date.** `due` is the milestone's date. `start`, `progress` and subtasks don't apply.
- **Dependencies stay.** A milestone depends on the tasks that must finish before it. Those tasks are what "block" the milestone.
- **No subtasks.** A milestone can't have subtasks or be given any.
- **Not on the Kanban.** The board shows tasks only.
- **Overview table.** The project overview lists milestones in a table, replacing the timeline strip.
- **Filter by milestone.** Table, Kanban and Gantt can show only the tasks that block a chosen milestone.

### Current state

| Concern            | Today                                                                                                                                    | Where                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Model              | `type: 'task' \| 'milestone' \| 'subtask'`. `subtasks: Task[]` exists on every task. `dependencies` holds a task's predecessor ids.      | `packages/core/src/types.ts`                                                            |
| Hydration          | Reads `type` from frontmatter. Doesn't check milestone fields.                                                                           | `YamlHydrator.ts`                                                                       |
| Editor             | Switching to milestone clears `start` and `progress`. It doesn't clear subtasks. The subtasks panel stays available.                    | `src/modals/TaskFormFields.ts`, `SubtasksPanel.ts`                                      |
| Creation           | "Add milestone" menu items in the table and Gantt headers. The subtask command can target a milestone.                                   | `ProjectView.ts`, `main.ts`                                                             |
| Kanban             | Milestones appear as cards, with a diamond icon.                                                                                         | `KanbanView.ts`, `boardColumns.ts`, `KanbanCard.ts`                                     |
| Gantt              | Diamond bar, labels and dashed line per dated milestone.                                                                                 | `GanttTaskBarRenderer.ts`, `packages/ui/src/gantt/bars.ts`                              |
| Overview           | Date-proportional dot timeline with a done count.                                                                                        | `ProjectOverviewView.ts`, `milestoneTimeline.ts`                                        |
| Filtering          | `type` is an ordinary list field, so a milestone can be filtered in or out. No filter relates tasks to the milestones they block.        | `FilterFields.ts`, `TaskFilter.ts`, `filterPopover.ts`                                  |
| Dependency graph   | `dependentsFromTasks` and `reaches` already compute who waits on whom, and cycle checks exist.                                           | `DependencyGraph.ts`                                                                    |

### Design decisions

1. **Enforce "no subtasks" in the model, not only the UI.** Hydration drops any subtask list on a milestone, as a guard. The store's mutators refuse to add one.
2. **Keep `type: 'milestone'`.** Don't add a separate entity. The vault format stays compatible, and milestones keep dependencies, dates, IDs, rename handling and Gantt rendering.
3. **Define "blocks milestone M".** A task blocks M when M is reachable from it through dependents, and the task isn't itself a milestone. Subtasks never count as blockers, even when their parent does.
4. **Add the filter as a computed field, not a stored one.** Add a `milestone` list field to `FilterFields`. Its value for a task is the ids of the milestones that task blocks. `FilterContext` gets a `blockedMilestones(task)` function, built from `dependentsFromTasks` once per render, the way `projectOf` works today. The filter picker accepts one milestone, and `any`, `none`, `empty` and `not-empty` work with no new operators. The Table, Kanban and Gantt views all reuse `matchesQuery`, so one change serves all three.
5. **Show the chosen milestone alongside its blockers.** The `milestone` filter keeps the milestone itself visible in Gantt (it is the thing the user picked), even though it doesn't "block itself". The table does the same.
6. **Overview table replaces the timeline.** Columns: title, date, status, count of open blockers (done/total), and overdue state. Sort by date. Rows open the milestone. Add a "blocked by" link that applies the milestone filter in the project view.

### Steps

1. **Model and hydration.** Force `subtasks = []` for milestones in `YamlHydrator`. Don't read `start` or `progress` for a milestone. Add tests in `yaml-round-trip.test.ts` for a milestone note carrying subtask, start and progress properties.
2. **Store guards.** Reject adding subtasks to a milestone in `ProjectStore` (`reconcileSubtasks`, move and duplicate paths). Refuse to change a task that has subtasks into a milestone. Test both.
3. **Editor and commands.** In `TaskFormFields`, hide the subtasks panel and parent picker for milestones. Drop the start date and progress controls. Make `new-subtask` and the context menu skip milestones.
4. **Kanban.** Filter milestones out in `boardColumns.ts`, and remove the milestone card variant in `KanbanCard.ts`. Update the board tests.
5. **Blocking filter.** Add the `milestone` field and the `blockedMilestones` context function in core, with tests in `TaskFilter.test.ts`. Add its picker, listing the project's milestones, to `filterPopover.ts`. Build the context in each of the three views, and check the multi-project scope (milestone ids resolve across projects only if dependencies can).
6. **Overview table.** Replace `renderMilestones` and `milestoneTimeline.ts` with a table. Delete the timeline component, its export and its CSS.
7. **Gantt.** Keep milestone drag (moves `due`) and disable resize. Confirm the diamond, label line and dependency arrows still read correctly when a milestone filter hides unrelated rows.
8. **Docs.** No migration. Update the README, docs and changelog.

### Decisions

- **Blocking is transitive.** A task blocks M when M is reachable from it through dependents. Direct-only isn't needed.
- **Milestone status is manual.** It isn't derived from blockers.
- **Milestones can be dragged in Gantt.** Dragging changes `due`. Resize does not apply, because a milestone has a single date.
- **Subtasks don't count as blocking.** Only the tasks that are linked by dependency (the top-level tasks in the graph) block a milestone.
- **One milestone per filter.** The `milestone` field takes a single value, so a filter condition uses `any` with one id, or `empty`/`not-empty`.
- **No legacy data to handle.** No milestones have subtasks, so no migration is needed. Hydration still drops a subtask list on a milestone as a guard.
