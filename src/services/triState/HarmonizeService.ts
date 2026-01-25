import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { DocumentationManager } from '../../managers/DocumentationManager';
import type { TriStateRegistry, TriStateStatus, TriStateTopic } from './types';
import RegistryService, { computeLocalContentHash } from './RegistryService';
import GovernanceService, { type GovernanceRules } from './GovernanceService';
import { computeTextNoCommentsHash, computeTsSignatureHash } from './SentinelService';
import { AiChatService, type ChatPromptMessage } from '../agentic/aiChatService';
import { getLogger } from '../LoggerService';
import RunTrackerService, { type StepHandle } from './RunTrackerService';

const execFileAsync = promisify(execFile);

const MAX_DOC_CHARS = 12000;
const MAX_DIFF_CHARS = 8000;

interface StrategyResponse {
  summary: string;
  proposed_changes?: string[];
  risks?: string[];
}

interface DraftResponse {
  markdown: string;
}

export default class HarmonizeService {
  private readonly logger = getLogger();

  constructor(
    private readonly workspaceRoot: string,
    private readonly documentManager: DocumentationManager,
    private readonly aiChat: AiChatService = new AiChatService(),
    private readonly governanceService: GovernanceService = new GovernanceService(workspaceRoot),
    private readonly registryService: RegistryService = new RegistryService(workspaceRoot)
  ) {}

  async harmonizeTopic(topicId: string): Promise<void> {
    const runTracker = new RunTrackerService(this.workspaceRoot);
    const runHandle = await runTracker.startRun('harmonize_topic', { topicIds: [topicId] });
    let activeStep: StepHandle | undefined;

    try {
      const registryPath = this.registryService.getDefaultRegistryPath();
      activeStep = await runTracker.startStep(
        runHandle,
        'load_inputs',
        await runTracker.buildInputs([registryPath], [topicId])
      );

      const registry = await this.registryService.loadRegistry();
      const topic = resolveTopic(registry, topicId);
      if (!topic) {
        await runTracker.finishStep(activeStep, { paths: [], hashes: {} }, 'FAILED', 'Topic not found.');
        await runTracker.finishRun(runHandle, 'FAILED');
        vscode.window.showErrorMessage(`Tri-State topic not found for "${topicId}".`);
        return;
      }

      const rules = await this.governanceService.loadRules();
      const { docPath, docText } = await this.loadTopicDocument(topic);
      const codeSummary = await this.buildCodeDiffSummary(topic);
      await runTracker.finishStep(
        activeStep,
        await runTracker.buildOutputs([docPath]),
        'SUCCESS',
        'Loaded registry, rules, and local document.'
      );

      activeStep = await runTracker.startStep(
        runHandle,
        'strategy',
        await runTracker.buildInputs([docPath], [topicId])
      );
      const strategy = await this.requestStrategy(topic, rules, codeSummary, docText);
      await runTracker.finishStep(activeStep, { paths: [], hashes: {} }, 'SUCCESS', 'Generated strategy.');

      activeStep = await runTracker.startStep(
        runHandle,
        'draft_patch',
        await runTracker.buildInputs([docPath], [topicId])
      );
      const draft = await this.requestDraft(topic, rules, codeSummary, docText, strategy);
      const proposedPath = await this.writeTempDraft(docPath, draft.markdown);
      await runTracker.finishStep(
        activeStep,
        await runTracker.buildOutputs([proposedPath]),
        'SUCCESS',
        'Drafted updated markdown.'
      );

      activeStep = await runTracker.startStep(
        runHandle,
        'review_diff',
        await runTracker.buildInputs([docPath, proposedPath], [topicId])
      );
      await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(docPath),
        vscode.Uri.file(proposedPath),
        `Authord: Harmonize Topic (${topic.id})`
      );

      const confirmed = await this.confirmApply();
      if (!confirmed) {
        await runTracker.finishStep(
          activeStep,
          { paths: [], hashes: {} },
          'FAILED',
          'User declined apply.'
        );
        await runTracker.finishRun(runHandle, 'FAILED');
        return;
      }
      await runTracker.finishStep(
        activeStep,
        { paths: [], hashes: {} },
        'SUCCESS',
        'User approved changes.'
      );

      activeStep = await runTracker.startStep(
        runHandle,
        'apply_patch',
        await runTracker.buildInputs([docPath], [topicId])
      );
      await fs.promises.writeFile(docPath, draft.markdown, 'utf8');
      await runTracker.finishStep(
        activeStep,
        await runTracker.buildOutputs([docPath]),
        'SUCCESS',
        'Applied draft to local file.'
      );

      activeStep = await runTracker.startStep(
        runHandle,
        'update_registry',
        await runTracker.buildInputs([registryPath], [topicId])
      );
      await this.updateRegistryAfterApply(registry, topic, draft.markdown);
      await runTracker.finishStep(
        activeStep,
        await runTracker.buildOutputs([registryPath]),
        'SUCCESS',
        'Updated registry hashes.'
      );

      await runTracker.finishRun(runHandle, 'SUCCESS');
    } catch (error: any) {
      if (activeStep) {
        await runTracker.finishStep(
          activeStep,
          { paths: [], hashes: {} },
          'FAILED',
          'Step failed.',
          error instanceof Error ? error : new Error(String(error))
        );
      }
      await runTracker.finishRun(runHandle, 'FAILED');
      throw error;
    }
  }

  private async loadTopicDocument(topic: TriStateTopic): Promise<{ docPath: string; docText: string }> {
    const topicsDir = this.documentManager.getTopicsDirectory();
    const relative = topic.local_state?.path;
    if (!relative) {
      throw new Error(`Topic ${topic.id} does not have a local_state.path.`);
    }
    const docPath = path.join(topicsDir, relative);
    const docText = await fs.promises.readFile(docPath, 'utf8');
    return { docPath, docText };
  }

  private async requestStrategy(
    topic: TriStateTopic,
    rules: GovernanceRules,
    codeSummary: string,
    docText: string
  ): Promise<StrategyResponse> {
    const systemPrompt =
      'You are the Authord Harmonize Strategist. Return strict JSON only with keys: summary, proposed_changes, risks.';
    const userPrompt = [
      `Topic: ${topic.name} (${topic.id})`,
      'Code diff summary:',
      truncate(codeSummary, MAX_DIFF_CHARS),
      'Current documentation:',
      truncate(docText, MAX_DOC_CHARS),
      'Governance rules (YAML):',
      toYamlString(rules),
    ].join('\n\n');

    const response = await this.collectChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    return parseJson<StrategyResponse>(response);
  }

  private async requestDraft(
    topic: TriStateTopic,
    rules: GovernanceRules,
    codeSummary: string,
    docText: string,
    strategy: StrategyResponse
  ): Promise<DraftResponse> {
    const systemPrompt =
      'You are the Authord Scribe. Return strict JSON only with key "markdown" containing the full updated markdown.';
    const userPrompt = [
      `Topic: ${topic.name} (${topic.id})`,
      'Strategy summary:',
      JSON.stringify(strategy, null, 2),
      'Code diff summary:',
      truncate(codeSummary, MAX_DIFF_CHARS),
      'Current documentation:',
      truncate(docText, MAX_DOC_CHARS),
      'Governance rules (YAML):',
      toYamlString(rules),
    ].join('\n\n');

    const response = await this.collectChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    return parseJson<DraftResponse>(response);
  }

  private async collectChat(messages: ChatPromptMessage[]): Promise<string> {
    const source = new vscode.CancellationTokenSource();
    try {
      const stream = await this.aiChat.send(messages, source.token);
      let result = '';
      for await (const chunk of stream) {
        result += chunk;
      }
      return result.trim();
    } finally {
      source.dispose();
    }
  }

  private async writeTempDraft(docPath: string, content: string): Promise<string> {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'authord-harmonize-'));
    const proposedPath = path.join(tempDir, path.basename(docPath));
    await fs.promises.writeFile(proposedPath, content, 'utf8');
    return proposedPath;
  }

  private async confirmApply(): Promise<boolean> {
    const result = await vscode.window.showInformationMessage(
      'Apply harmonized documentation changes?',
      { modal: true },
      'Yes',
      'No'
    );
    return result === 'Yes';
  }

  private async updateRegistryAfterApply(
    registry: TriStateRegistry,
    topic: TriStateTopic,
    newMarkdown: string
  ): Promise<void> {
    const now = new Date().toISOString();
    if (!topic.local_state) {
      topic.local_state = { path: topic.id, content_hash: '', updated_at: now };
    }
    topic.local_state.content_hash = computeLocalContentHash(newMarkdown);
    topic.local_state.updated_at = now;

    let nextStatus: TriStateStatus = 'DRAFT';
    if (topic.code_contract) {
      const currentHash = await this.computeContractHash(topic);
      if (currentHash) {
        topic.code_contract.last_known_hash = currentHash;
        nextStatus = 'SYNCED';
      } else {
        nextStatus = 'DRIFTED';
      }
    }

    topic.tri_state = nextStatus;
    registry.updated_at = now;
    await this.registryService.saveRegistry(registry);
  }

  private async computeContractHash(topic: TriStateTopic): Promise<string | undefined> {
    const contract = topic.code_contract;
    if (!contract) return undefined;
    const symbol = contract.symbols?.[0];
    if (!symbol) return undefined;

    const filePath = resolveSymbolFile(symbol);
    if (!filePath) return undefined;
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(this.workspaceRoot, filePath);

    let fileText = '';
    try {
      fileText = await fs.promises.readFile(resolved, 'utf8');
    } catch {
      return undefined;
    }

    if (contract.hash_algo === 'text_nocomments_v1') {
      return computeTextNoCommentsHash(fileText);
    }
    if (contract.hash_algo === 'ts_signature_v1') {
      return computeTsSignatureHash(fileText, symbol);
    }
    return undefined;
  }

  private async buildCodeDiffSummary(topic: TriStateTopic): Promise<string> {
    const contract = topic.code_contract;
    if (!contract || !contract.symbols?.length) {
      return 'No code contract symbols available.';
    }
    const files = Array.from(
      new Set(
        contract.symbols
          .map((symbol) => resolveSymbolFile(symbol))
          .filter((value): value is string => Boolean(value))
      )
    );
    if (files.length === 0) {
      return 'No code contract file references available.';
    }

    const summaries = await Promise.all(
      files.map(async (file) => {
        const resolved = path.isAbsolute(file) ? file : path.join(this.workspaceRoot, file);
        const relative = path.relative(this.workspaceRoot, resolved);
        const diff = await this.readGitDiff(relative);
        const snapshot = await this.readFileSnapshot(resolved);
        const body = diff.trim()
          ? truncate(diff, MAX_DIFF_CHARS)
          : `No git diff detected. Current snapshot:\n${truncate(snapshot, MAX_DIFF_CHARS)}`;
        return `File: ${relative}\n${body}`;
      })
    );

    return summaries.join('\n\n');
  }

  private async readGitDiff(relativePath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--', relativePath], {
        cwd: this.workspaceRoot,
      });
      return stdout ?? '';
    } catch (error) {
      this.logger.debug('Git diff unavailable for harmonize.', error);
      return '';
    }
  }

  private async readFileSnapshot(filePath: string): Promise<string> {
    try {
      return await fs.promises.readFile(filePath, 'utf8');
    } catch {
      return '';
    }
  }
}

function resolveTopic(registry: TriStateRegistry, topicId: string): TriStateTopic | undefined {
  if (!registry?.topics) return undefined;
  const direct = registry.topics[topicId];
  if (direct) return direct;
  const normalizedTarget = normalizePathValue(topicId);
  return Object.values(registry.topics).find((topic) => {
    const localPath = topic.local_state?.path;
    if (!localPath) return false;
    return normalizePathValue(localPath) === normalizedTarget;
  });
}

function resolveSymbolFile(symbol: string): string | undefined {
  const trimmed = symbol.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('file:') || trimmed.startsWith('path:')) {
    const [, rest] = trimmed.split(/:(.+)/);
    if (!rest) return undefined;
    const [filePath] = rest.split('#');
    return filePath;
  }
  if (trimmed.includes('#')) {
    const [filePath] = trimmed.split('#');
    if (looksLikePath(filePath)) return filePath;
  }
  if (looksLikePath(trimmed)) return trimmed;
  return undefined;
}

function looksLikePath(value: string): boolean {
  return value.includes('/') || value.includes('\\') || /\.[a-z0-9]+$/i.test(value);
}

function normalizePathValue(value: string): string {
  return path.normalize(value).replace(/\\/g, '/').toLowerCase();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…(truncated)…`;
}

function parseJson<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : trimmed;
  return JSON.parse(jsonText) as T;
}

function toYamlString(rules: GovernanceRules): string {
  return [
    `schema_version: ${rules.schema_version}`,
    `updated_at: ${rules.updated_at}`,
    'rules:',
    ...rules.rules.map((rule) => {
      return [
        `  - id: "${rule.id}"`,
        `    description: "${rule.description}"`,
        `    severity: "${rule.severity}"`,
      ].join('\n');
    }),
  ].join('\n');
}
