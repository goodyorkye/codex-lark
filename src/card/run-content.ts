import type { HistoryResource } from './history-content';
import { projectHistoryMarkdown } from './history-content';
import type { Block, RunState } from './run-state';

export interface ProjectedRunContent {
  state: RunState;
  resources: HistoryResource[];
}

/**
 * Project model-authored text blocks into CardKit-safe Markdown and collect
 * transferable resources for native delivery once the live run finishes.
 *
 * Keeping projection pure makes it safe to call on every streaming update;
 * actual file reads and Feishu uploads happen only after the terminal event.
 */
export function projectRunContent(state: RunState): ProjectedRunContent {
  const resources: HistoryResource[] = [];
  const seen = new Set<string>();
  const blocks = state.blocks.map((block): Block => {
    if (block.kind !== 'text') return block;
    const projected = projectHistoryMarkdown(block.content, 'agent-output');
    for (const resource of projected.resources) {
      const key = `${resource.kind}\u0000${resource.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push(resource);
    }
    return { ...block, content: projected.markdown };
  });
  return {
    state: { ...state, blocks },
    resources,
  };
}
