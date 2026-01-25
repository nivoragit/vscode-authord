import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';

export type CapabilityStatus = 'IMPLEMENTED' | 'PARTIAL' | 'MISSING';

export interface BlueprintSignalSpec {
  files_exist?: string[];
  exports_exist?: string[];
  commands_exist?: string[];
  settings_exist?: string[];
  notes?: string;
}

export interface BlueprintCapability {
  id: string;
  description: string;
  depends_on: string[];
  signals: BlueprintSignalSpec;
  phase_hint: 1 | 2 | 3;
  priority: number;
}

export interface Blueprint {
  schema_version: 1;
  name: 'tri-state';
  capabilities: BlueprintCapability[];
}

export interface RepoSignals {
  files: Set<string>;
  exports: Set<string>;
  commands: Set<string>;
  settings: Set<string>;
}

export interface SignalEvidence {
  files: string[];
  exports: string[];
  commands: string[];
  settings: string[];
}

export interface CapabilityDiff {
  capability: BlueprintCapability;
  status: CapabilityStatus;
  found: SignalEvidence;
  missing: SignalEvidence;
}

export interface DiffResult {
  capabilities: CapabilityDiff[];
  summary: {
    implemented: number;
    partial: number;
    missing: number;
  };
}

const DEFAULT_BLUEPRINT_PATH = path.join('_authord', 'blueprints', 'tri-state.blueprint.yaml');

export default class BlueprintDiffService {
  constructor(private readonly workspaceRoot: string) {}

  blueprintPath(): string {
    return path.join(this.workspaceRoot, DEFAULT_BLUEPRINT_PATH);
  }

  async loadBlueprint(): Promise<Blueprint> {
    const blueprintPath = this.blueprintPath();
    const raw = await fs.promises.readFile(blueprintPath, 'utf8');
    const parsed = load(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Blueprint is not a mapping: ${blueprintPath}`);
    }
    const blueprint = parsed as Blueprint;
    if (blueprint.schema_version !== 1 || blueprint.name !== 'tri-state') {
      throw new Error(`Unsupported blueprint schema: ${blueprintPath}`);
    }
    if (!Array.isArray(blueprint.capabilities)) {
      throw new Error(`Blueprint capabilities missing: ${blueprintPath}`);
    }
    return blueprint;
  }

  async scanRepo(): Promise<RepoSignals> {
    const files = await listFiles(this.workspaceRoot);
    const exportsSet = new Set<string>();
    const commands = new Set<string>();
    const settings = new Set<string>();

    const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const raw = await fs.promises.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw);
      const contributes = pkg?.contributes ?? {};
      const cmdEntries = Array.isArray(contributes.commands) ? contributes.commands : [];
      cmdEntries.forEach((cmd: any) => {
        if (cmd?.command) commands.add(String(cmd.command));
      });
      const properties = contributes.configuration?.properties ?? {};
      Object.keys(properties).forEach((key) => settings.add(key));
    }

    const tsFiles = Array.from(files).filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'));
    for (const relPath of tsFiles) {
      const absPath = path.join(this.workspaceRoot, relPath);
      const content = await fs.promises.readFile(absPath, 'utf8');
      extractExports(content).forEach((symbol) => exportsSet.add(symbol));
    }

    return {
      files,
      exports: exportsSet,
      commands,
      settings,
    };
  }

  diff(blueprint: Blueprint, repoSignals: RepoSignals): DiffResult {
    const diffs: CapabilityDiff[] = blueprint.capabilities.map((capability) => {
      const found: SignalEvidence = { files: [], exports: [], commands: [], settings: [] };
      const missing: SignalEvidence = { files: [], exports: [], commands: [], settings: [] };
      const signals = capability.signals || {};

      const fileSignals = signals.files_exist ?? [];
      fileSignals.forEach((relPath) => {
        const resolved = path.isAbsolute(relPath)
          ? relPath
          : path.normalize(relPath).replace(/\\/g, '/');
        const exists = repoSignals.files.has(resolved) || fs.existsSync(path.join(this.workspaceRoot, relPath));
        if (exists) found.files.push(relPath);
        else missing.files.push(relPath);
      });

      const exportSignals = signals.exports_exist ?? [];
      exportSignals.forEach((symbol) => {
        if (repoSignals.exports.has(symbol)) found.exports.push(symbol);
        else missing.exports.push(symbol);
      });

      const commandSignals = signals.commands_exist ?? [];
      commandSignals.forEach((command) => {
        if (repoSignals.commands.has(command)) found.commands.push(command);
        else missing.commands.push(command);
      });

      const settingSignals = signals.settings_exist ?? [];
      settingSignals.forEach((setting) => {
        if (repoSignals.settings.has(setting)) found.settings.push(setting);
        else missing.settings.push(setting);
      });

      const totalSignals =
        fileSignals.length + exportSignals.length + commandSignals.length + settingSignals.length;
      const foundCount =
        found.files.length + found.exports.length + found.commands.length + found.settings.length;

      let status: CapabilityStatus = 'MISSING';
      if (totalSignals === 0) {
        status = 'MISSING';
      } else if (foundCount === 0) {
        status = 'MISSING';
      } else if (foundCount === totalSignals) {
        status = 'IMPLEMENTED';
      } else {
        status = 'PARTIAL';
      }

      return {
        capability,
        status,
        found,
        missing,
      };
    });

    const summary = diffs.reduce(
      (acc, diff) => {
        if (diff.status === 'IMPLEMENTED') acc.implemented += 1;
        else if (diff.status === 'PARTIAL') acc.partial += 1;
        else acc.missing += 1;
        return acc;
      },
      { implemented: 0, partial: 0, missing: 0 }
    );

    return { capabilities: diffs, summary };
  }

  computeDependencyOrder(blueprint: Blueprint): BlueprintCapability[] {
    const nodes = new Map<string, BlueprintCapability>();
    blueprint.capabilities.forEach((capability) => {
      nodes.set(capability.id, capability);
    });

    const inDegree = new Map<string, number>();
    const edges = new Map<string, Set<string>>();

    nodes.forEach((_, id) => {
      inDegree.set(id, 0);
      edges.set(id, new Set());
    });

    nodes.forEach((capability, id) => {
      (capability.depends_on || []).forEach((dep) => {
        if (!nodes.has(dep)) {
          throw new Error(`Unknown dependency "${dep}" for capability "${id}"`);
        }
        edges.get(dep)!.add(id);
        inDegree.set(id, (inDegree.get(id) || 0) + 1);
      });
    });

    const queue = Array.from(nodes.keys()).filter((id) => (inDegree.get(id) || 0) === 0);
    queue.sort((a, b) => {
      const capA = nodes.get(a)!;
      const capB = nodes.get(b)!;
      if (capA.priority !== capB.priority) return capA.priority - capB.priority;
      return a.localeCompare(b);
    });

    const ordered: BlueprintCapability[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const capability = nodes.get(id)!;
      ordered.push(capability);
      edges.get(id)!.forEach((neighbor) => {
        inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1);
        if ((inDegree.get(neighbor) || 0) === 0) {
          queue.push(neighbor);
          queue.sort((a, b) => {
            const capA = nodes.get(a)!;
            const capB = nodes.get(b)!;
            if (capA.priority !== capB.priority) return capA.priority - capB.priority;
            return a.localeCompare(b);
          });
        }
      });
    }

    if (ordered.length !== nodes.size) {
      throw new Error('Dependency cycle detected in blueprint capabilities.');
    }

    return ordered;
  }
}

async function listFiles(root: string): Promise<Set<string>> {
  const results = new Set<string>();
  await walk(root, root, results);
  return results;
}

async function walk(root: string, current: string, results: Set<string>): Promise<void> {
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'out') {
      continue;
    }
    const fullPath = path.join(current, entry.name);
    const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await walk(root, fullPath, results);
    } else if (entry.isFile()) {
      results.add(relPath);
    }
  }
}

function extractExports(source: string): string[] {
  const exports: string[] = [];
  const directRegex = /export\s+(?:declare\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z0-9_]+)/g;
  const exportListRegex = /export\s*\{([^}]+)\}/g;
  const defaultClassRegex = /export\s+default\s+class\s+([A-Za-z0-9_]+)/g;

  let match: RegExpExecArray | null;
  while ((match = directRegex.exec(source)) !== null) {
    exports.push(match[1]);
  }

  while ((match = defaultClassRegex.exec(source)) !== null) {
    exports.push(match[1]);
  }

  while ((match = exportListRegex.exec(source)) !== null) {
    const block = match[1];
    block.split(',').forEach((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return;
      const parts = trimmed.split(/\s+as\s+/i);
      exports.push((parts[1] || parts[0]).trim());
    });
  }

  return exports;
}
