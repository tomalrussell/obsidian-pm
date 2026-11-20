# Codebase simplification plan

## Product direction

Aim for Markdown tasks with fixed statuses, a table, and a status board. Keep persistence safeguards: queued writes, rename handling, unknown frontmatter preservation, and ID repair. Feature usage is a user decision; this review identifies complexity rather than measuring usage.

## Current functionality

| Area                      | Functionality                                                                | Implementation                            |
| ------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| Persistence               | Notes, YAML, wikilinks, rename handling, caching, sync and queued writes     | src/store/ProjectStore.ts, VaultIndex.ts  |
| Tasks                     | Subtasks, dependencies, milestones, dates and progress                       | packages/core/src/types.ts                |
| Views                     | Table, Gantt, Kanban, dashboard, overview and editors                        | src/views, packages/ui                    |
| Organization              | Independent projects, multi-project scopes, archives, moving and duplication | ProjectScope, ProjectStore, ArchiveOps    |
| Configuration             | Fixed priorities, filtering, grouping, saved views, layouts                  | Core configuration and view-state modules |
| Automation                | Scheduling, early-finish adjustment and auto-archiving                       | Scheduler, AutoArchiver                   |
| External access (removed) | Local HTTP API, MCP and client library removed                               | src/api, packages/api                     |
| Sharing (removed)         | HTML export and browser snapshot viewer removed                              | Completed                                 |
| Support                   | Migrations, ID repair, release notes, styleguide                             | Integration and support modules           |

ProjectStore is the largest central module, at approximately 1,700 lines at review time, and combines persistence with imports, duplication, moves, archives, attachments and cross-project scheduling.

## Dependencies

Two workspace packages remain: core and ui. The Obsidian plugin combines them. The original review also included a viewer package, now removed.

| Dependency                                 | Role                                                        | Removal opportunity                      |
| ------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------- |
| Obsidian                                   | Vault, views, Markdown, native controls and production YAML | Foundational                             |
| temporal-polyfill                          | Dates, filters, timeline, scheduling                        | Keep while date arithmetic remains       |
| monkey-around                              | Intercept Markdown opening for custom editors               | Remove with automatic editor replacement |
| hono (removed)                             | HTTP routing and authentication                             | Removed with HTTP API                    |
| mcp-lite (removed)                         | MCP server                                                  | Removed with MCP                         |
| valibot, @valibot/to-json-schema (removed) | Validation and MCP schemas                                  | Removed with API/MCP                     |
| yaml                                       | Test YAML codec                                             | Production uses Obsidian codec           |
| TypeScript, tsdown, lightningcss           | Build                                                       | Retain as needed                         |
| Vitest, happy-dom                          | Tests                                                       | Retain as needed                         |
| ESLint, oxlint, oxfmt                      | Lint and format                                             | Review overlap after feature cuts        |

Audit package-publication and configuration dependencies if publishing reusable npm packages is no longer a goal. Manifest declarations alone do not prove a dependency is unused.

## Removal options

| Option                                   | Status    | Complexity reduction | Scope                                                                                                                                            |
| ---------------------------------------- | --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Remove translation and locales           | Completed | Medium               | Translation layer, locale files, localized labels, locale-dependent date and sorting behavior removed                                            |
| Remove people, members and assignees     | Completed | High                 | Model fields, people controls, avatars, filters, grouping, settings, exports and API support removed                                             |
| Finish fixed-status cleanup              | Completed | Small                | Fixed options enforced; project override types, indexed palettes and status editors removed                                                      |
| Fix priorities                           | Completed | Medium               | Fixed lowercase yesterday/high/medium/low; removed palette and icon settings and project overrides; legacy critical values map to yesterday      |
| Remove toast notifications and reminders | Completed | Medium               | Removed Obsidian Notice calls, helpers, hourly due-date checks and notification settings; validation and console logging retained                |
| Remove recurrence                        | Completed | Small to medium      | Metadata, controls, imports, serialization and indicators removed; legacy note properties preserved inert                                        |
| Remove time tracking                     | Completed | Medium               | Estimates, logs, editor panel, rollups and time cells removed; legacy note properties preserved inert                                            |
| Remove TaskNotes                         | Completed | Medium               | Detection, priority sync, special import conversion, related store methods, tests and docs removed                                               |
| Remove export and viewer                 | Completed | High                 | HTML export, snapshot format and renderers, viewer package, assets and build steps removed                                                       |
| Remove scheduling                        | Open      | High                 | Scheduler, settings, early finish and propagation across projects                                                                                |
| Remove Gantt                             | Open      | Very high            | Timeline rendering, drag/resize/link, calendars and scales                                                                                       |
| Status-only Kanban                       | Open      | Medium to high       | Generic field grouping, per-field column configuration and drag updates                                                                          |
| Remove custom fields                     | Completed | Very high            | Definitions, global defaults, editors, filters, grouping and rendering                                                                           |
| Flatten projects                         | Completed | High                 | Parent links, ancestor inheritance, project trees, collapse state, subtree scopes and inherited archive behavior removed; task subtasks retained |
| Remove saved views/layout customization  | Open      | Medium to high       | Named/starred views, change tracking, scope persistence and configurable columns                                                                 |
| Remove API/MCP                           | Completed | High                 | Server, MCP tools, contracts, client, authentication, settings, dependencies, tests and docs removed                                             |

Smaller options: auto-archiving, release-note UI, automatic Markdown editor replacement. Styleguide removal primarily reduces maintenance because production builds already exclude it.

## Sequence

1. Finish status cleanup; remove recurrence and time tracking. **Completed.** Removed project status override types, indexed palette fields, status editors and redundant status palette merging. Removed recurrence and time tracking across the model, UI, API, imports and docs. Legacy task metadata is preserved as inert frontmatter.
2. Export and browser viewer removal: **Completed.** Removed HTML export commands, snapshots and snapshot-only renderers, viewer package, viewer assets and build steps. TaskNotes removal: **Completed.** Removed detection, settings, priority syncing, special import conversion, conversion-only store methods, tests and documentation. Ordinary Markdown note import remains.
3. Fixed priorities: **Completed.** Priorities are `yesterday`, `high`, `medium`, `low`, with matching lowercase IDs and labels. Removed global/project palette and icon settings. Old `critical` tasks and saved selections resolve to `yesterday`. Status-only Kanban remains an option.
4. Decide whether to retain scheduling; if unnecessary, remove Gantt, scheduling, dependencies and milestones together.
5. Project flattening: **Completed.** Projects are independent: removed parent links, ancestor inheritance, project trees, project collapse state and subtree scopes. Task subtasks remain. Custom-field removal: **Completed.** Removed definitions, global defaults, editors, columns, filters and board grouping. Existing custom-field note properties remain inert frontmatter. Saved views remain an option for later simplification.
6. API/MCP removal: **Completed.** Removed server, routes, MCP tools, contracts, client, authentication and port settings, API tests and documentation, package publishing trigger and dependencies. Any future agent interface or CLI is deferred.

For each removal, cover controls, types, serialization, API fields, styles, tests and docs. Preserve removed metadata as inert frontmatter where practical. Future steps require a user decision.

Toast notifications and due-date reminders: **Completed.** Removed Notice calls, notification helpers, hourly reminder checks and notification settings. Validation and confirmation dialogs remain; errors are logged to the console.
