import * as fs from 'fs';
import * as path from 'path';
import type { BlueprintCapability, CapabilityDiff, DiffResult } from './BlueprintDiffService';

interface WritePlanOptions {
  workspaceRoot: string;
  blueprintName: string;
}

export default class IntegrationPlanWriter {
  private readonly outputPath: string;
  private readonly blueprintName: string;

  constructor(private readonly workspaceRoot: string, blueprintName = 'tri-state') {
    this.outputPath = path.join(workspaceRoot, 'docs', 'architecture', 'tri-state-integration.md');
    this.blueprintName = blueprintName;
  }

  async writePlan(diffResult: DiffResult, orderedCapabilities: BlueprintCapability[]): Promise<void> {
    await ensureDir(path.dirname(this.outputPath));
    const markdown = buildPlan({
      workspaceRoot: this.workspaceRoot,
      blueprintName: this.blueprintName,
    }, diffResult, orderedCapabilities);
    await fs.promises.writeFile(this.outputPath, markdown, 'utf8');
  }
}

function buildPlan(options: WritePlanOptions, diffResult: DiffResult, orderedCapabilities: BlueprintCapability[]): string {
  const now = new Date().toISOString();
  const summary = diffResult.summary;
  const diffMap = new Map(diffResult.capabilities.map((diff) => [diff.capability.id, diff]));

  const mappingRows = orderedCapabilities.map((capability) => {
    const diff = diffMap.get(capability.id);
    const detected = diff ? formatDetected(diff.found) : '-';
    const notes = diff ? formatNotes(diff) : 'No scan evidence.';
    return `| ${capability.id} | ${detected} | ${notes} |`;
  });

  const phases = groupByPhase(orderedCapabilities);
  const phaseRows = phases.map(([phase, caps]) => {
    const names = caps.map((capability) => capability.id).join(', ');
    return `| ${phase} | ${names || '-'} |`;
  });

  const nextPrompts = buildNextPrompts(orderedCapabilities, diffMap);

  return [
    `# Tri-State Integration Plan`,
    '',
    `Generated: ${now}`,
    `Blueprint: ${options.blueprintName}`,
    '',
    `## Integration Summary`,
    `- Implemented capabilities: ${summary.implemented}`,
    `- Partial capabilities: ${summary.partial}`,
    `- Missing capabilities: ${summary.missing}`,
    `- Total capabilities scanned: ${diffResult.capabilities.length}`,
    '',
    `## Merge Strategy`,
    `- Keep changes additive and scoped to tri-state services and commands.`,
    `- Preserve existing commands and settings; add new keys with clear defaults.`,
    `- Use deterministic YAML and atomic writes for registry outputs.`,
    `- Add tests alongside each capability to keep the diff output stable.`,
    '',
    `## Current-to-Blueprint Mapping`,
    `| Blueprint concept | Detected repo surface | Integration notes |`,
    `| --- | --- | --- |`,
    ...mappingRows,
    '',
    `## Phased Delivery`,
    `| Phase | Capabilities (dependency order) |`,
    `| --- | --- |`,
    ...phaseRows,
    '',
    `## Next Prompts`,
    ...nextPrompts.map((prompt, index) => `${index + 1}. ${prompt}`),
    '',
  ].join('\n');
}

function formatDetected(found: CapabilityDiff['found']): string {
  const parts: string[] = [];
  if (found.files.length) parts.push(`files: ${found.files.map((f) => `\`${f}\``).join(', ')}`);
  if (found.exports.length) parts.push(`exports: ${found.exports.map((e) => `\`${e}\``).join(', ')}`);
  if (found.commands.length) parts.push(`commands: ${found.commands.map((c) => `\`${c}\``).join(', ')}`);
  if (found.settings.length) parts.push(`settings: ${found.settings.map((s) => `\`${s}\``).join(', ')}`);
  return parts.length ? parts.join('; ') : '-';
}

function formatNotes(diff: CapabilityDiff): string {
  if (diff.status === 'IMPLEMENTED') return 'All expected signals detected.';
  if (diff.status === 'MISSING') return 'No signals detected.';
  const missing: string[] = [];
  if (diff.missing.files.length) missing.push(`files: ${diff.missing.files.join(', ')}`);
  if (diff.missing.exports.length) missing.push(`exports: ${diff.missing.exports.join(', ')}`);
  if (diff.missing.commands.length) missing.push(`commands: ${diff.missing.commands.join(', ')}`);
  if (diff.missing.settings.length) missing.push(`settings: ${diff.missing.settings.join(', ')}`);
  return `Partial coverage; missing ${missing.join('; ') || 'signals'}.`;
}

function groupByPhase(capabilities: BlueprintCapability[]): Array<[number, BlueprintCapability[]]> {
  const map = new Map<number, BlueprintCapability[]>();
  capabilities.forEach((capability) => {
    const phase = capability.phase_hint;
    if (!map.has(phase)) map.set(phase, []);
    map.get(phase)!.push(capability);
  });

  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}

function buildNextPrompts(
  orderedCapabilities: BlueprintCapability[],
  diffMap: Map<string, CapabilityDiff>
): string[] {
  const prompts: string[] = [];
  const prioritized = orderedCapabilities.slice(0, 11);
  prioritized.forEach((capability) => {
    const diff = diffMap.get(capability.id);
    const status = diff ? diff.status : 'MISSING';
    prompts.push(`Implement ${capability.id} (${status.toLowerCase()}) and update signals/tests.`);
  });

  while (prompts.length < 11) {
    prompts.push('Review blueprint gaps and add new capability signals.');
  }

  return prompts.slice(0, 11);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}
