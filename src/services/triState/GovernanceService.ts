import * as fs from 'fs';
import * as path from 'path';
import { dump, load } from 'js-yaml';

export interface GovernanceRule {
  id: string;
  description: string;
  severity: 'warn' | 'block';
}

export interface GovernanceRules {
  schema_version: 1;
  updated_at: string;
  rules: GovernanceRule[];
}

export class GovernanceParseError extends Error {
  readonly path: string;

  constructor(pathValue: string, message: string) {
    super(`Governance parse error (${pathValue}): ${message}`);
    this.name = 'GovernanceParseError';
    this.path = pathValue;
  }
}

export function getDefaultRulesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '_authord', 'governance', 'rules.yaml');
}

export async function loadRules(workspaceRoot: string): Promise<GovernanceRules> {
  const rulesPath = getDefaultRulesPath(workspaceRoot);
  await fs.promises.mkdir(path.dirname(rulesPath), { recursive: true });

  if (!fs.existsSync(rulesPath)) {
    const defaults = createDefaultRules();
    await saveRules(workspaceRoot, defaults);
    return defaults;
  }

  const raw = await fs.promises.readFile(rulesPath, 'utf8');
  if (!raw.trim()) {
    return createDefaultRules();
  }

  let parsed: any;
  try {
    parsed = load(raw);
  } catch (error: any) {
    throw new GovernanceParseError(rulesPath, String(error?.message || error));
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new GovernanceParseError(rulesPath, 'Rules content is not a mapping.');
  }

  return normalizeRules(parsed as Partial<GovernanceRules>);
}

export async function saveRules(workspaceRoot: string, rules: GovernanceRules): Promise<void> {
  const rulesPath = getDefaultRulesPath(workspaceRoot);
  await fs.promises.mkdir(path.dirname(rulesPath), { recursive: true });
  const normalized = normalizeRules(rules);
  let yamlText = dump(normalized, { sortKeys: true, lineWidth: 120, noRefs: true });
  if (!yamlText.endsWith('\n')) {
    yamlText += '\n';
  }
  await fs.promises.writeFile(rulesPath, yamlText, 'utf8');
}

export default class GovernanceService {
  constructor(private readonly workspaceRoot: string) {}

  loadRules(): Promise<GovernanceRules> {
    return loadRules(this.workspaceRoot);
  }
}

function createDefaultRules(): GovernanceRules {
  return {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    rules: [
      {
        id: 'doc-tone-active-voice',
        description: 'Use active voice and concise sentences.',
        severity: 'warn',
      },
    ],
  };
}

function normalizeRules(rules: Partial<GovernanceRules>): GovernanceRules {
  return {
    schema_version: 1,
    updated_at: rules.updated_at ?? new Date().toISOString(),
    rules: rules.rules ?? [],
  };
}
