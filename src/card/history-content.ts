import { extname } from 'node:path';
import type { CodexThreadItem } from '../codex/app-server/protocol';

export type HistoryResourceKind = 'image' | 'file' | 'audio' | 'video';

export interface HistoryResource {
  kind: HistoryResourceKind;
  source: string;
  label: string;
  origin: 'user-input' | 'agent-output';
}

export interface HistoryContent {
  markdown: string;
  resources: HistoryResource[];
}

/**
 * Project model-authored Markdown into the subset that CardKit can safely
 * accept. In particular, CardKit interprets Markdown image destinations as
 * Feishu image keys, so a normal URL or local path makes the whole card fail.
 * Media references are removed from the Markdown and returned separately for
 * delivery as native Feishu media/file messages.
 */
export function projectHistoryMarkdown(
  input: string,
  origin: HistoryResource['origin'] = 'agent-output',
): HistoryContent {
  const resources: HistoryResource[] = [];
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let fence: { marker: '`' | '~'; length: number } | undefined;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0] as '`' | '~';
      const length = fenceMatch[1]!.length;
      if (!fence) fence = { marker, length };
      else if (fence.marker === marker && length >= fence.length) fence = undefined;
      output.push(line);
      continue;
    }
    if (fence) {
      output.push(line);
      continue;
    }
    output.push(projectInline(line, origin, resources));
  }

  if (fence) output.push(fence.marker.repeat(fence.length));
  return {
    markdown: output.join('\n').trim(),
    resources: dedupeResources(resources),
  };
}

export function projectUserMessage(item: CodexThreadItem): HistoryContent {
  const markdown: string[] = [];
  const resources: HistoryResource[] = [];
  const content = Array.isArray(item.content) ? item.content : [];
  for (const rawPart of content) {
    if (!isRecord(rawPart)) continue;
    const type = stringValue(rawPart.type);
    if (type === 'text') {
      const projected = projectHistoryMarkdown(stringValue(rawPart.text), 'user-input');
      if (projected.markdown) markdown.push(projected.markdown);
      resources.push(...projected.resources);
      continue;
    }
    if (type === 'localImage') {
      const source = stringValue(rawPart.path);
      if (source && isTransferableSource(source)) {
        const resource = historyResource(source, '图片', 'user-input', 'image');
        resources.push(resource);
        markdown.push(resourcePlaceholder(resource));
      }
      continue;
    }
    if (type === 'image') {
      const source = stringValue(rawPart.url);
      if (source && isTransferableSource(source)) {
        const resource = historyResource(source, '图片', 'user-input', 'image');
        resources.push(resource);
        markdown.push(resourcePlaceholder(resource));
      }
      continue;
    }
    if (type) markdown.push(`📎 未识别的输入附件：${escapeInline(type)}`);
  }
  return {
    markdown: markdown.join('\n\n').trim(),
    resources: dedupeResources(resources),
  };
}

export function inferHistoryResourceKind(
  source: string,
  hint?: HistoryResourceKind,
): HistoryResourceKind {
  if (hint) return hint;
  const extension = sourceExtension(source);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'file';
}

function projectInline(
  line: string,
  origin: HistoryResource['origin'],
  resources: HistoryResource[],
): string {
  let output = '';
  let index = 0;
  while (index < line.length) {
    const code = parseCodeSpan(line, index);
    if (code) {
      output += code.raw;
      index = code.end;
      continue;
    }

    const image = parseMarkdownLink(line, index, true);
    if (image) {
      if (isTransferableSource(image.destination)) {
        const resource = historyResource(image.destination, image.label || '图片', origin);
        resources.push(resource);
        output += resourcePlaceholder(resource);
      } else {
        output += `🖼️ ${escapeInline(image.label || '图片')}（不支持的来源）`;
      }
      index = image.end;
      continue;
    }

    const link = parseMarkdownLink(line, index, false);
    if (link) {
      if (isSafeWebLink(link.destination)) {
        output += link.raw;
      } else if (!isTransferableSource(link.destination)) {
        output += escapeInline(link.label || '链接');
      } else {
        const resource = historyResource(link.destination, link.label || '文件', origin);
        resources.push(resource);
        output += resourcePlaceholder(resource);
      }
      index = link.end;
      continue;
    }

    if (line[index] === '<') {
      const tag = parseAngleConstruct(line, index);
      if (tag) {
        if (tag.safeAutolink) {
          output += tag.raw;
        } else if (tag.source && isTransferableSource(tag.source)) {
          const resource = historyResource(
            tag.source,
            tag.label || mediaLabel(tag.hint),
            origin,
            tag.hint,
          );
          resources.push(resource);
          output += resourcePlaceholder(resource);
        } else {
          output += neutralizeAngles(tag.raw);
        }
        index = tag.end;
        continue;
      }
    }

    // Reference-style images are not useful in CardKit and can still be
    // interpreted as media by future Markdown parsers. Neutralize the bang;
    // the reference definition remains ordinary visible text.
    if (line[index] === '!' && line[index + 1] === '[') {
      output += '🖼️ ';
      index += 1;
      continue;
    }
    output += line[index];
    index += 1;
  }
  return output;
}

interface ParsedInline {
  raw: string;
  end: number;
}

interface ParsedMarkdownLink extends ParsedInline {
  label: string;
  destination: string;
}

function parseCodeSpan(input: string, start: number): ParsedInline | undefined {
  if (input[start] !== '`') return undefined;
  let ticks = 1;
  while (input[start + ticks] === '`') ticks += 1;
  const marker = '`'.repeat(ticks);
  const close = input.indexOf(marker, start + ticks);
  if (close < 0) return undefined;
  const end = close + ticks;
  return { raw: input.slice(start, end), end };
}

function parseMarkdownLink(
  input: string,
  start: number,
  image: boolean,
): ParsedMarkdownLink | undefined {
  const labelStart = image ? start + 1 : start;
  if ((image && input[start] !== '!') || input[labelStart] !== '[') return undefined;
  if (!image && start > 0 && input[start - 1] === '!') return undefined;
  const labelEnd = findBalanced(input, labelStart, '[', ']');
  if (labelEnd < 0 || input[labelEnd + 1] !== '(') return undefined;
  const destinationEnd = findBalanced(input, labelEnd + 1, '(', ')');
  if (destinationEnd < 0) return undefined;
  const rawDestination = input.slice(labelEnd + 2, destinationEnd).trim();
  const destination = extractDestination(rawDestination);
  if (!destination) return undefined;
  const end = destinationEnd + 1;
  return {
    raw: input.slice(start, end),
    end,
    label: unescapeMarkdown(input.slice(labelStart + 1, labelEnd)).trim(),
    destination,
  };
}

function findBalanced(
  input: string,
  start: number,
  open: '[' | '(',
  close: ']' | ')',
): number {
  let depth = 0;
  for (let index = start; index < input.length; index += 1) {
    if (input[index] === '\\') {
      index += 1;
      continue;
    }
    if (input[index] === open) depth += 1;
    else if (input[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function extractDestination(raw: string): string {
  if (raw.startsWith('<')) {
    const close = raw.indexOf('>');
    return close > 0 ? unescapeMarkdown(raw.slice(1, close)).trim() : '';
  }
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')' && depth > 0) depth -= 1;
    else if (/\s/.test(char) && depth === 0) {
      return unescapeMarkdown(raw.slice(0, index)).trim();
    }
  }
  return unescapeMarkdown(raw).trim();
}

interface ParsedAngle extends ParsedInline {
  safeAutolink: boolean;
  source?: string;
  label?: string;
  hint?: HistoryResourceKind;
}

function parseAngleConstruct(input: string, start: number): ParsedAngle | undefined {
  const close = input.indexOf('>', start + 1);
  if (close < 0) return undefined;
  const raw = input.slice(start, close + 1);
  const inner = raw.slice(1, -1).trim();
  if (/^https?:\/\/[^\s<>]+$/i.test(inner)) {
    return { raw, end: close + 1, safeAutolink: true };
  }
  const tag = inner.match(/^\/?\s*([A-Za-z][\w-]*)\b/);
  if (!tag) return { raw, end: close + 1, safeAutolink: false };
  const tagName = tag[1]!.toLowerCase();
  let hint = ({
    img: 'image',
    image: 'image',
    audio: 'audio',
    video: 'video',
    file: 'file',
    media: 'file',
  } as Record<string, HistoryResourceKind | undefined>)[tagName];
  const sourceTag = tagName === 'source';
  if ((!hint && !sourceTag) || inner.startsWith('/')) {
    return { raw, end: close + 1, safeAutolink: false };
  }
  const source = attributeValue(inner, ['src', 'path', 'href']);
  const label = attributeValue(inner, ['alt', 'title', 'name']);
  if (sourceTag && source) {
    const mime = attributeValue(inner, ['type'])?.toLowerCase() ?? '';
    hint = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('audio/')
        ? 'audio'
        : mime.startsWith('video/')
          ? 'video'
          : inferHistoryResourceKind(source);
  }
  return {
    raw,
    end: close + 1,
    safeAutolink: false,
    ...(source ? { source } : {}),
    ...(label ? { label } : {}),
    hint,
  };
}

function attributeValue(tag: string, names: string[]): string | undefined {
  for (const name of names) {
    const quoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
    if (quoted?.[2]) return quoted[2];
    const bare = tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i'));
    if (bare?.[1]) return bare[1];
  }
  return undefined;
}

function historyResource(
  source: string,
  label: string,
  origin: HistoryResource['origin'],
  hint?: HistoryResourceKind,
): HistoryResource {
  return {
    kind: inferHistoryResourceKind(source, hint ?? kindHintFromLabel(label)),
    source: source.trim(),
    label: cleanLabel(label),
    origin,
  };
}

function kindHintFromLabel(label: string): HistoryResourceKind | undefined {
  const normalized = label.trim().toLowerCase();
  if (/(?:图片|图像|截图|image|img|screenshot|photo)/i.test(normalized)) return 'image';
  if (/(?:音频|录音|语音|audio|voice|sound)/i.test(normalized)) return 'audio';
  if (/(?:视频|录像|video|movie|clip)/i.test(normalized)) return 'video';
  if (/(?:文件|附件|file|attachment)/i.test(normalized)) return 'file';
  return undefined;
}

function resourcePlaceholder(resource: HistoryResource): string {
  const icon = ({ image: '🖼️', file: '📎', audio: '🎵', video: '🎬' } as const)[resource.kind];
  const label = escapeInline(resource.label || mediaLabel(resource.kind));
  if (isSafeWebLink(resource.source)) {
    return `${icon} [${label}](${resource.source})`;
  }
  return `${icon} ${label}（${escapeInline(fileDisplayName(resource.source))}）`;
}

function sourceExtension(source: string): string {
  try {
    const parsed = new URL(source);
    return extname(parsed.pathname).toLowerCase();
  } catch {
    return extname(source.split(/[?#]/, 1)[0] ?? '').toLowerCase();
  }
}

function fileDisplayName(source: string): string {
  const normalized = source.replace(/\\/g, '/').replace(/\/+$/, '');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  return decodeURIComponentSafe(name || source);
}

function cleanLabel(label: string): string {
  return label.replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || '附件';
}

function mediaLabel(kind: HistoryResourceKind | undefined): string {
  return ({ image: '图片', file: '文件', audio: '音频', video: '视频' } as const)[kind ?? 'file'];
}

function isSafeWebLink(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value.trim());
}

function isTransferableSource(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isSafeWebLink(trimmed) || /^file:\/\//i.test(trimmed)) return true;
  if (/^[a-z]:[\\/]/i.test(trimmed) || /^\\\\/.test(trimmed)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

function neutralizeAngles(value: string): string {
  return value.replace(/</g, '‹').replace(/>/g, '›');
}

function escapeInline(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&');
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, '$1');
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function dedupeResources(resources: HistoryResource[]): HistoryResource[] {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.kind}\0${resource.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const IMAGE_EXTENSIONS = new Set([
  '.avif', '.bmp', '.gif', '.heic', '.heif', '.ico', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp',
]);
const AUDIO_EXTENSIONS = new Set([
  '.aac', '.amr', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.webm',
]);
const VIDEO_EXTENSIONS = new Set([
  '.avi', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.webm',
]);
