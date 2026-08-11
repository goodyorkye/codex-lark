const DEFAULT_PREVIEW_MAX_CHARS = 80;

export function normalizeSessionPreview(input: string, maxChars = DEFAULT_PREVIEW_MAX_CHARS): string {
  const text = extractBridgeUserInput(input) ?? input;
  return truncatePreview(text.replace(/\s+/g, ' ').trim(), maxChars);
}

function extractBridgeUserInput(input: string): string | undefined {
  const section = readPromptSection(input, 'user_input');
  if (!section) return undefined;
  const parsed = parseJsonObject(section);
  const text = typeof parsed?.text === 'string' ? parsed.text : undefined;
  return text?.trim() ? text : undefined;
}

function readPromptSection(input: string, tag: string): string | undefined {
  const match = input.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`));
  return match?.[1];
}

function parseJsonObject(input: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(input) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function truncatePreview(input: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  const chars = Array.from(input);
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : input;
}
