export type NormalizedCard =
  | null
  | boolean
  | number
  | string
  | NormalizedCard[]
  | { [key: string]: NormalizedCard };

export function normalizeCard(value: unknown): NormalizedCard {
  if (value === null) return null;

  if (
    typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCard(item));
  }

  if (typeof value === 'object') {
    const normalized: { [key: string]: NormalizedCard } = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeCard((value as Record<string, unknown>)[key]);
    }
    return normalized;
  }

  return String(value);
}
