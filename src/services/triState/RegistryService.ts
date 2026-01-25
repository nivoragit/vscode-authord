import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { dump, load } from 'js-yaml';
import type { TriStateRegistry, TriStateTopic, TriStateStatus } from './types';

export class RegistryParseError extends Error {
  readonly path: string;

  constructor(pathValue: string, message: string) {
    super(`Registry parse error (${pathValue}): ${message}`);
    this.name = 'RegistryParseError';
    this.path = pathValue;
  }
}

export function getDefaultRegistryPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '_authord', 'topics', 'index.yaml');
}

export async function loadRegistry(workspaceRoot: string): Promise<TriStateRegistry> {
  const registryPath = getDefaultRegistryPath(workspaceRoot);
  await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });

  if (!fs.existsSync(registryPath)) {
    const empty = createEmptyRegistry();
    await saveRegistry(workspaceRoot, empty);
    return empty;
  }

  const raw = await fs.promises.readFile(registryPath, 'utf8');
  if (!raw.trim()) {
    return createEmptyRegistry();
  }

  let parsed: any;
  try {
    parsed = load(raw);
  } catch (error: any) {
    throw new RegistryParseError(registryPath, String(error?.message || error));
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new RegistryParseError(registryPath, 'Registry content is not a mapping.');
  }

  return normalizeRegistry(parsed as Partial<TriStateRegistry>);
}

export async function saveRegistry(workspaceRoot: string, registry: TriStateRegistry): Promise<void> {
  const registryPath = getDefaultRegistryPath(workspaceRoot);
  await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });

  const normalized = normalizeRegistry(registry);
  let yamlText = dump(normalized, { sortKeys: true, lineWidth: 120, noRefs: true });
  if (!yamlText.endsWith('\n')) {
    yamlText += '\n';
  }

  const tempPath = `${registryPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tempPath, yamlText, 'utf8');

  try {
    await fs.promises.rename(tempPath, registryPath);
  } catch (error: any) {
    if (error?.code === 'EEXIST' || error?.code === 'EPERM') {
      await fs.promises.rm(registryPath, { force: true });
      await fs.promises.rename(tempPath, registryPath);
    } else {
      try {
        await fs.promises.rm(tempPath, { force: true });
      } catch {
        // ignore cleanup errors
      }
      throw error;
    }
  }
}

export function upsertTopic(registry: TriStateRegistry, topic: TriStateTopic): TriStateRegistry {
  return {
    ...registry,
    topics: {
      ...registry.topics,
      [topic.id]: topic,
    },
  };
}

export function computeLocalContentHash(markdownText: string): string {
  const normalized = normalizeLineEndings(markdownText ?? '');
  return createHash('sha256').update(normalized).digest('hex');
}

export function getTopicStatusFromRegistry(topicId: string, registry: TriStateRegistry): TriStateStatus {
  const topic = resolveTopic(registry, topicId);
  if (!topic) return 'MISSING';
  if (topic.tri_state) return topic.tri_state;
  const hasLocal = Boolean(topic.local_state?.path);
  if (!topic.remote_state && hasLocal) return 'DRAFT';
  if (!hasLocal) return 'MISSING';
  return 'SYNCED';
}

export async function getTopicStatus(workspaceRoot: string, topicId: string): Promise<TriStateStatus> {
  const registry = await loadRegistry(workspaceRoot);
  return getTopicStatusFromRegistry(topicId, registry);
}

export default class RegistryService {
  constructor(private readonly workspaceRoot: string) {}

  getDefaultRegistryPath(): string {
    return getDefaultRegistryPath(this.workspaceRoot);
  }

  loadRegistry(): Promise<TriStateRegistry> {
    return loadRegistry(this.workspaceRoot);
  }

  saveRegistry(registry: TriStateRegistry): Promise<void> {
    return saveRegistry(this.workspaceRoot, registry);
  }

  getTopicStatus(topicId: string): Promise<TriStateStatus> {
    return getTopicStatus(this.workspaceRoot, topicId);
  }

  getTopicStatusFromRegistry(topicId: string, registry: TriStateRegistry): TriStateStatus {
    return getTopicStatusFromRegistry(topicId, registry);
  }
}

function createEmptyRegistry(): TriStateRegistry {
  return {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    topics: {},
  };
}

function normalizeRegistry(registry: Partial<TriStateRegistry>): TriStateRegistry {
  return {
    schema_version: 1,
    updated_at: registry.updated_at ?? new Date().toISOString(),
    topics: registry.topics ?? {},
  };
}

function resolveTopic(registry: TriStateRegistry, topicId: string): TriStateTopic | undefined {
  const direct = registry.topics?.[topicId];
  if (direct) return direct;
  const normalizedTarget = normalizePathValue(topicId);
  return Object.values(registry.topics || {}).find((topic) => {
    const localPath = topic?.local_state?.path;
    if (!localPath) return false;
    return normalizePathValue(localPath) === normalizedTarget;
  });
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizePathValue(value: string): string {
  return path.normalize(value).replace(/\\/g, '/').toLowerCase();
}
