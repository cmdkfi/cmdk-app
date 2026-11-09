// JSON with bigint values, for the browser caches (position snapshot, activity): a bigint is written as
// {"$bigint":"<decimal>"} and read back as a bigint. Nothing else changes.
export function stringifyBig(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v))
}

export function parseBig<T = unknown>(text: string): T {
  return JSON.parse(text, (_key, v) => (v && typeof v === 'object' && typeof v.$bigint === 'string' && Object.keys(v).length === 1 ? BigInt(v.$bigint) : v)) as T
}
