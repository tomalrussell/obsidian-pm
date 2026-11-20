# Codebase simplification plan

## Product direction

Aim for Markdown tasks with fixed statuses, a table, and a status board. Keep persistence safeguards: queued writes, rename handling, unknown frontmatter preservation, and ID repair. Feature usage is a user decision; this review identifies complexity rather than measuring usage.

## Current functionality

| Area                      | Functionality                                                                             | Implementation                            |
| ------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| Persistence               | Notes, YAML, wikilinks, rename handling, caching, sync and queued writes                  | src/store/ProjectStore.ts, VaultIndex.ts  |
| Tasks                     | Subtasks, dependencies, milestones, dates, progress, recurrence metadata, estimates, logs | packages/core/src/types.ts                |
| Views                     | Table, Gantt, Kanban, dashboard, overview and editors                                     | src/views, packages/ui                    |
| Organization              | Independent projects, multi-project scopes, archives, moving and duplication              | ProjectScope, ProjectStore, ArchiveOps    |
| Configuration             | Custom fields, priority palettes, filtering, grouping, saved views, layouts               | Core configuration and view-state modules |
| Automation                | Scheduling, early-finish adjustment, reminders, auto-archiving                            | Scheduler, Notifier, AutoArchiver         |
| External access (removed) | Local HTTP API, MCP and client library removed                                            | src/api, packages/api                     |
| Sharing (removed)         | HTML export and browser snapshot viewer removed                                           | Completed                                 |
| Support                   | Migrations, ID repair, release notes, styleguide                                          | Integration and support modules           |

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

| Option                                  | Complexity reduction | Scope                                                                                                   |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| Finish fixed-status cleanup             | Small                | Obsolete project override types, indexed fields, editors, comments                                      |
| Remove recurrence                       | Small to medium      | Metadata, controls, imports, API, serialization, view indicators; no occurrence-generation engine found |
| Remove time tracking                    | Medium               | Estimates, logs, editor, rollups, view cells, API, serialization                                        |
| Remove TaskNotes (completed)            | Medium               | Detection, palette sync, special import mapping and relationship conversion                             |
| Remove export and viewer                | High                 | Viewer package, snapshots, browser compatibility, export command, extra build                           |
| Remove scheduling                       | High                 | Scheduler, settings, early finish and propagation across projects                                       |
| Remove Gantt                            | Very high            | Timeline rendering, drag/resize/link, calendars and scales                                              |
| Status-only Kanban                      | Medium to high       | Generic field grouping, per-field column configuration, drag updates                                    |
| Remove custom fields                    | Very high            | Definitions, inheritance, editors, filters, grouping, validation and rendering                          |
| Flatten projects                        | High                 | Parent projects, inheritance, subtree scopes, navigation and archive behavior                           |
| Remove saved views/layout customization | Medium to high       | Named/starred views, change tracking, scope persistence and configurable columns                        |
| Remove API/MCP                          | High                 | Server, authentication, schemas, routing, changelog and client                                          |

Smaller options: reminders, auto-archiving, release-note UI, automatic Markdown editor replacement. Styleguide removal primarily reduces maintenance because production builds already exclude it.

## Sequence

1. Finish status cleanup; remove recurrence and time tracking. **Completed.** Removed project status override types, indexed palette fields, status editors and redundant status palette merging. Removed recurrence and time tracking across the model, UI, API, imports and docs. Legacy task metadata is preserved as inert frontmatter.
2. Export and browser viewer removal: **Completed.** Removed HTML export commands, snapshots and snapshot-only renderers, viewer package, viewer assets and build steps. TaskNotes removal: **Completed.** Removed detection, settings, priority syncing, special import conversion, conversion-only store methods, tests and documentation. Ordinary Markdown note import remains.
3. Consider status-only Kanban and fixed priorities.
4. Decide whether to retain scheduling; if unnecessary, remove Gantt, scheduling, dependencies and milestones together.
5. Project flattening: **Completed.** Projects are independent: removed parent links, ancestor inheritance, project trees, project collapse state and subtree scopes. Task subtasks remain. Custom fields and saved views remain options for later simplification.
6. API/MCP removal: **Completed.** Removed server, routes, MCP tools, contracts, client, authentication and port settings, API tests and documentation, package publishing trigger and dependencies. Any future agent interface or CLI is deferred.

For each removal, cover controls, types, serialization, API fields, styles, tests and docs. Preserve removed metadata as inert frontmatter where practical. Future steps require a user decision.
