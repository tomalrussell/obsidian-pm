import { Temporal } from 'temporal-polyfill'

export { Temporal }

export function today(): Temporal.PlainDate {
  return Temporal.Now.plainDateISO()
}

export function parsePlainDate(s: string): Temporal.PlainDate | null {
  if (!s) return null
  try {
    return Temporal.PlainDate.from(s)
  } catch {
    return null
  }
}

let dateFormat = ''

/** Moment-style tokens for date labels; '' uses the fixed English format. */
export function setDateFormat(format: string): void {
  dateFormat = format.trim()
}

const pad = (value: number, length: number): string => String(value).padStart(length, '0')
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DATE_TOKENS: Record<string, (date: Temporal.PlainDate) => string> = {
  YYYY: (date) => pad(date.year, 4),
  YY: (date) => pad(date.year % 100, 2),
  MMMM: (date) => MONTHS[date.month - 1],
  MMM: (date) => MONTHS[date.month - 1].slice(0, 3),
  MM: (date) => pad(date.month, 2),
  M: (date) => String(date.month),
  DD: (date) => pad(date.day, 2),
  D: (date) => String(date.day),
  dddd: (date) => WEEKDAYS[utcDate(date).getUTCDay()],
  ddd: (date) => WEEKDAYS[utcDate(date).getUTCDay()].slice(0, 3)
}

/** Text in square brackets is kept as written. */
const DATE_PATTERN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g

function formatPlainDate(iso: string, year?: 'numeric' | '2-digit'): string {
  const date = parsePlainDate(iso)
  if (!date) return ''
  if (!dateFormat) {
    const month = MONTHS[date.month - 1].slice(0, 3)
    if (year === 'numeric') return `${month} ${date.day}, ${date.year}`
    if (year === '2-digit') return `${month} ${date.day}, ${String(date.year).slice(-2)}`
    return `${month} ${date.day}`
  }
  return dateFormat.replace(DATE_PATTERN, (token, literal: string | undefined) => literal ?? DATE_TOKENS[token](date))
}

/** "Jun 15, 2026", or '' when empty or invalid. */
export function formatDate(iso: string): string {
  return formatPlainDate(iso, 'numeric')
}

/** "Mar 28", or '' when empty or invalid. */
export function formatDateShort(iso: string): string {
  return formatPlainDate(iso)
}

/** "Mar 28, 26", or '' when empty or invalid. */
export function formatDateLong(iso: string): string {
  return formatPlainDate(iso, '2-digit')
}

/** "Mar 28 - 31" in fixed English date formatting. */
export function formatDateRange(start: Temporal.PlainDate, end: Temporal.PlainDate): string {
  const firstMonth = MONTHS[start.month - 1].slice(0, 3)
  const lastMonth = MONTHS[end.month - 1].slice(0, 3)
  if (start.year !== end.year) return `${firstMonth} ${start.day}, ${start.year} - ${lastMonth} ${end.day}, ${end.year}`
  if (start.month !== end.month) return `${firstMonth} ${start.day} - ${lastMonth} ${end.day}`
  return `${firstMonth} ${start.day} - ${end.day}`
}

function utcDate(date: Temporal.PlainDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day))
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'outcome'

/** Null past a week out, where a relative hint adds nothing. `from` is injectable for tests. */
export function relativeDue(iso: string, from: Temporal.PlainDate = today()): { text: string; tone: DueTone } | null {
  const due = parsePlainDate(iso)
  if (!due) return null
  const days = from.until(due, { largestUnit: 'day' }).days
  if (days < 0) return { text: `${-days}d overdue`, tone: 'overdue' }
  if (days === 0) return { text: 'Today', tone: 'today' }
  if (days === 1) return { text: 'Tomorrow', tone: 'today' }
  if (days <= 6) return { text: `In ${days}d`, tone: 'soon' }
  return null
}

/** Whether a finished task landed on its due date; null unless both dates are set. */
export function completionOutcome(due: string, completed: string): { text: string; tone: DueTone } | null {
  const dueDate = parsePlainDate(due)
  const completedDate = parsePlainDate(completed)
  if (!dueDate || !completedDate) return null
  const days = dueDate.until(completedDate, { largestUnit: 'day' }).days
  return { text: days > 0 ? `${days}d late` : 'On time', tone: 'outcome' }
}
