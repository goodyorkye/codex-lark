import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDesktopProjects } from '../../../src/codex/desktop-projects';

describe('Codex Desktop project list', () => {
  it('uses local-projects filtered and ordered by project-order', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-desktop-projects-'));
    await mkdir(codexHome, { recursive: true });
    await writeFile(join(codexHome, '.codex-global-state.json'), JSON.stringify({
      'project-order': ['project-b', 'project-a'],
      'local-projects': {
        'project-a': {
          id: 'project-a',
          name: '项目 A',
          rootPaths: ['/tmp/project-a'],
        },
        'project-b': {
          id: 'project-b',
          name: '项目 B',
          rootPaths: ['/tmp/project-b', '/tmp/project-b-tools'],
        },
        orphan: {
          id: 'orphan',
          name: 'zh',
          rootPaths: ['/tmp/zh'],
        },
      },
      'sidebar-project-thread-orders': {
        'project-b': { threadIds: ['thread-1', 'thread-2'] },
      },
    }), 'utf8');

    await expect(listDesktopProjects({ codexHome })).resolves.toEqual([
      {
        id: 'project-b',
        name: '项目 B',
        cwd: '/tmp/project-b',
        rootPaths: ['/tmp/project-b', '/tmp/project-b-tools'],
        taskCount: 2,
      },
      {
        id: 'project-a',
        name: '项目 A',
        cwd: '/tmp/project-a',
        rootPaths: ['/tmp/project-a'],
        taskCount: 0,
      },
    ]);
  });
});
