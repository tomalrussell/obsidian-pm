import type { PMSettings, Project, ResolvedProjectConfig } from '../types'
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES } from '../types'

/** Fixed task options and project behavior overrides over the global defaults. */
export function resolveProjectConfig(project: Project, settings: PMSettings): ResolvedProjectConfig {
  const config = project.config
  return {
    statuses: DEFAULT_STATUSES,
    priorities: DEFAULT_PRIORITIES,
    priorityIcons: 'chevrons',
    defaultView: config?.defaultView ?? settings.defaultView,
    autoArchiveDays: config?.autoArchiveDays ?? settings.autoArchiveDays,
    showSubtreeConnections: config?.showSubtreeConnections ?? settings.showSubtreeConnections,
    lineBorders: config?.lineBorders ?? settings.lineBorders
  }
}
