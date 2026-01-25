import * as fs from 'fs';
import * as path from 'path';
import type { DocumentationManager } from '../../managers/DocumentationManager';
import type { TocElement } from '../../utils/types';
import { stableTextHash } from '../agentic/embeddings';
import { computeLocalContentHash, getDefaultRegistryPath, loadRegistry, saveRegistry } from './RegistryService';
import type { TriStateTopic } from './types';

interface BootstrapResult {
  registryPath: string;
  addedTopics: number;
  totalTopics: number;
}

export default class TriStateBootstrapService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly documentManager: DocumentationManager
  ) {}

  async bootstrapRegistry(): Promise<BootstrapResult> {
    const instances = this.documentManager.getInstances();
    const registry = await loadRegistry(this.workspaceRoot);
    const registryPath = getDefaultRegistryPath(this.workspaceRoot);
    const now = new Date().toISOString();

    if (!instances || instances.length === 0) {
      await saveRegistry(this.workspaceRoot, registry);
      return { registryPath, addedTopics: 0, totalTopics: 0 };
    }

    const existingKeys = new Set(Object.keys(registry.topics ?? {}));
    const existingByPath = new Map<string, string>();
    Object.entries(registry.topics ?? {}).forEach(([key, topic]) => {
      if (topic?.local_state?.path) {
        existingByPath.set(topic.local_state.path, key);
      }
    });

    const topicsDir = this.documentManager.getTopicsDirectory();
    let added = 0;
    let total = 0;

    instances.forEach((instance) => {
      const tocEntries = collectTopicEntries(instance['toc-elements']);
      total += tocEntries.length;
      tocEntries.forEach((entry) => {
        if (existingByPath.has(entry.topic)) return;
        const key = buildUniqueKey(instance.id, entry.topic, existingKeys);
        const contentHash = loadContentHash(path.join(topicsDir, entry.topic));
        const name = entry.title || fallbackName(entry.topic);
        const id = buildTopicId(instance.id, entry.topic);
        const topic: TriStateTopic = {
          id,
          name,
          tri_state: 'DRAFT',
          code_contract: null,
          local_state: {
            path: entry.topic,
            content_hash: contentHash,
            updated_at: now,
          },
          remote_state: null,
        };

        registry.topics[key] = topic;
        existingByPath.set(entry.topic, key);
        added += 1;
      });
    });

    if (added > 0) {
      registry.updated_at = now;
    }
    await saveRegistry(this.workspaceRoot, registry);
    return { registryPath, addedTopics: added, totalTopics: total };
  }
}

function collectTopicEntries(tocElements: TocElement[]): Array<{ topic: string; title: string }> {
  const results: Array<{ topic: string; title: string }> = [];
  const traverse = (elements: TocElement[]) => {
    elements.forEach((element) => {
      results.push({ topic: element.topic, title: element.title });
      if (element.children && element.children.length > 0) {
        traverse(element.children);
      }
    });
  };
  traverse(tocElements);
  return results;
}

function buildTopicId(instanceId: string, topicPath: string): string {
  const seed = `${instanceId}:${topicPath}`;
  return `topic_${stableTextHash(seed).slice(0, 12)}`;
}

function loadContentHash(filePath: string): string {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return computeLocalContentHash(raw);
  } catch {
    return computeLocalContentHash('');
  }
}

function fallbackName(topicPath: string): string {
  const base = path.basename(topicPath, path.extname(topicPath));
  return base.replace(/[-_]+/g, ' ').replace(/\w/g, (match) => match.toUpperCase());
}

function buildUniqueKey(instanceId: string, topicPath: string, existing: Set<string>): string {
  const baseName = path.basename(topicPath, path.extname(topicPath));
  const candidateBase = slugify(`${instanceId}-${baseName}`);
  let candidate = candidateBase;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${candidateBase}-${counter}`;
    counter += 1;
  }
  existing.add(candidate);
  return candidate;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}
