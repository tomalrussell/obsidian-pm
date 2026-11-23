import { stringToColor } from '@dotpm/core'
import { Chip } from '#primitives/Chip'

export function renderTagChip(parent: HTMLElement, tag: string): Chip {
  return new Chip(parent).setLabel(tag).setVariant('outline').setTag().setDot(true).setColor(stringToColor(tag))
}
