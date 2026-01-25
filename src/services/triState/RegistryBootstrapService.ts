import * as fs from 'fs';
import * as path from 'path';
import TopicsService from '../TopicsService';
import type { DocumentationManager } from '../../managers/DocumentationManager';
import type { TocElement } from '../../utils/types';
import type { TriStateRegistry, TriStateTopic } from './types';
import { computeLocalContentHash, getDefaultRegistryPath, loadRegistry, saveRegistry } from './RegistryService';

export default class RegistryBootstrapService {
  constructor(private readonly documentManager: DocumentationManager) {}

  async bootstrapFromTopics(workspaceRoot: string): Promise<{ created: boolean; topicsAdded: number }> {
    const registryPath = getDefaultRegistryPath(workspaceRoot);
    const registryExists = fs.existsSync(registryPath);
    let registry: TriStateRegistry;
    const now = new Date().toISOString();

    if (!registryExists) {
      await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });
      registry = {
        schema_version: 1,
        updated_at: now,
        topics: {},
      };
    } else {
      registry = await loadRegistry(workspaceRoot);
    }

    const topicsDir = this.documentManager.getTopicsDirectory();
    const instances = this.documentManager.getInstances();
    const existingKeys = new Set(Object.keys(registry.topics));
    const existingPaths = new Set(
      Object.values(registry.topics)
        .map((topic) => topic.local_state?.path)
        .filter((value): value is string => Boolean(value))
    );

    let topicsAdded = 0;

    instances.forEach((instance) => {
      const tocEntries = collectTopicEntries(instance['toc-elements']);
      tocEntries.forEach((entry) => {
        const topicId = entry.id || entry.topic;
        if (existingKeys.has(topicId)) return;
        if (existingPaths.has(entry.topic)) return;

        const filePath = path.join(topicsDir, entry.topic);
        const content = readFileSafe(filePath);
        const topic: TriStateTopic = {
          id: topicId,
          name: entry.title || fallbackName(entry.topic),
          tri_state: 'SYNCED',
          code_contract: null,
          local_state: {
            path: entry.topic,
            content_hash: computeLocalContentHash(content),
            updated_at: now,
          },
          remote_state: null,
        };

        registry.topics[topicId] = topic;
        existingKeys.add(topicId);
        existingPaths.add(entry.topic);
        topicsAdded += 1;
      });
    });

    const created = !registryExists;
    if (created || topicsAdded > 0) {
      registry.updated_at = now;
      await saveRegistry(workspaceRoot, registry);
    }

    return { created, topicsAdded };
  }
}

function collectTopicEntries(tocElements: TocElement[]): Array<{ topic: string; title: string; id?: string }> {
  const results: Array<{ topic: string; title: string; id?: string }> = [];
  const traverse = (elements: TocElement[]) => {
    elements.forEach((element) => {
      const id = (element as any).id as string | undefined;
      results.push({ topic: element.topic, title: element.title, id });
      if (element.children && element.children.length > 0) {
        traverse(element.children);
      }
    });
  };
  traverse(tocElements);
  return results;
}

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function fallbackName(topicPath: string): string {
  const base = path.basename(topicPath, path.extname(topicPath));
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
