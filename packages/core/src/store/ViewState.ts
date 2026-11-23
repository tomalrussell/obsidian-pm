/** JSON with object keys in a fixed order, so two equal values always compare equal. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : v
  )
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}
