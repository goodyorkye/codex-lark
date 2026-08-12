import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export interface DesktopProjectSummary {
  id: string;
  name: string;
  cwd: string;
  rootPaths: string[];
  taskCount: number;
}

export interface ListDesktopProjectsOptions {
  codexHome?: string;
}

/** Read the same local project collection and ordering used by Codex Desktop. */
export async function listDesktopProjects(
  options: ListDesktopProjectsOptions = {},
): Promise<DesktopProjectSummary[]> {
  const codexHome = options.codexHome?.trim() || join(homedir(), '.codex');
  const raw = JSON.parse(
    await readFile(join(codexHome, '.codex-global-state.json'), 'utf8'),
  ) as unknown;
  if (!isRecord(raw)) return [];

  const projects = isRecord(raw['local-projects']) ? raw['local-projects'] : {};
  const order = stringArray(raw['project-order']);
  const threadOrders = isRecord(raw['sidebar-project-thread-orders'])
    ? raw['sidebar-project-thread-orders']
    : {};

  return order.flatMap((id) => {
    const project = projects[id];
    if (!isRecord(project)) return [];
    const rootPaths = stringArray(project.rootPaths);
    if (rootPaths.length === 0) return [];
    const threadOrder = threadOrders[id];
    const taskCount = isRecord(threadOrder)
      ? new Set(stringArray(threadOrder.threadIds)).size
      : 0;
    const name = stringValue(project.name) || basename(rootPaths[0]!) || rootPaths[0]!;
    return [{ id, name, cwd: rootPaths[0]!, rootPaths, taskCount }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
