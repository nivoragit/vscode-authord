import * as vscode from 'vscode';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import FileService from './FileService';
import TopicsService from './TopicsService';
import { getLogger } from './LoggerService';
import { DocumentationManager } from '../managers/DocumentationManager';
import { InstanceProfile, TocElement } from '../utils/types';

const execFileAsync = promisify(execFile);
const logger = getLogger();

const PROJECT_ROOT_STATE_KEY = 'authord.projectRoot';

const MAX_TEST_FILES = 10;
const MAX_OTHER_FILES = 20;

const MAX_FILE_CHARS = 5000;
const MAX_DIFF_CHARS = 6000;
const MAX_FILE_LIST = 200;

// Hardening: avoid runaway prompt sizes and UI spam.
const MAX_PROMPT_CHARS = 120_000;
const MAX_ERROR_CHARS = 600;

// Hardening: custom provider network limits.
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

interface FileContext {
  filePath: string;
  content: string;
  truncated: boolean;
}

interface CommitContext {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  stats: string;
  changedFiles: string[];
  testFiles: string[];
  otherFiles: string[];
  testContexts: FileContext[];
  diffContexts: FileContext[];
  omittedTestFiles: string[];
  omittedOtherFiles: string[];
}

export interface CommitDocumentationResult {
  filePath: string;
  title: string;
  topicFile: string;
}

type ProgressReporter = (message: string) => void;

type AiProvider = 'copilot' | 'vscode' | 'custom';

interface AiSelectionConfig {
  provider: AiProvider;
  vendor?: string;
  modelId?: string;
  allowModelPicker: boolean;
}

interface CustomProviderConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  chatEndpoint?: string;
  requestTimeoutMs?: number;
}

export default class CommitDocumentationService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly documentManager: DocumentationManager,
    private readonly workspaceRoot: string
  ) {}

  public async generateForHeadCommit(
    doc: InstanceProfile,
    progress?: ProgressReporter
  ): Promise<CommitDocumentationResult | undefined> {
    const report = progress ?? (() => undefined);

    report('Resolving project root...');
    const projectRoot = await this.resolveProjectRoot();
    if (!projectRoot) return undefined;

    report('Collecting commit context...');
    const commitContext = await this.collectCommitContext(projectRoot);
    if (!commitContext) return undefined;

    report('Generating documentation with AI...');
    const markdown = await this.generateMarkdown(commitContext);
    if (!markdown) return undefined;

    report('Preparing documentation output...');
    // Enforce ASCII-only output as promised.
    let sanitized = sanitizeAscii(markdown);

    // Make sure fallback title is ALSO ASCII to avoid reintroducing non-ASCII.
    const rawFallback = commitContext.subject || `Commit ${commitContext.shortSha}`;
    const fallbackTitle = sanitizeAscii(rawFallback).trim() || `Commit ${commitContext.shortSha}`;

    let title = extractTitle(sanitized, fallbackTitle);
    title = sanitizeAscii(title).trim() || fallbackTitle;

    sanitized = ensureTitleHeading(sanitized, title);

    report('Writing documentation file...');
    const topicFile = await this.createTopicFile(title, sanitized);
    const newTopic: TocElement = { topic: topicFile, title, children: [] };

    doc['toc-elements'].push(newTopic);
    if (!doc['start-page']) {
      doc['start-page'] = topicFile;
    }

    report('Saving documentation metadata...');
    await this.documentManager.saveInstance(doc);

    return {
      filePath: path.join(this.documentManager.getTopicsDirectory(), topicFile),
      title,
      topicFile,
    };
  }

  private async resolveProjectRoot(): Promise<string | undefined> {
    const detectedRoot = await this.tryGitRoot(this.workspaceRoot);
    const workspaceResolved = path.resolve(this.workspaceRoot);
    if (detectedRoot && path.resolve(detectedRoot) === workspaceResolved) {
      return detectedRoot;
    }

    const storedRoot = this.context.workspaceState.get<string>(PROJECT_ROOT_STATE_KEY);
    if (storedRoot && await isExistingDirectory(storedRoot)) {
      const storedGitRoot = await this.tryGitRoot(storedRoot);
      if (storedGitRoot) {
        if (path.resolve(storedGitRoot) !== path.resolve(storedRoot)) {
          await this.context.workspaceState.update(PROJECT_ROOT_STATE_KEY, storedGitRoot);
        }
        return storedGitRoot;
      }
    }

    const selectedRoot = await this.promptForProjectRoot(detectedRoot);
    if (!selectedRoot) return undefined;

    await this.context.workspaceState.update(PROJECT_ROOT_STATE_KEY, selectedRoot);
    return selectedRoot;
  }

  private async promptForProjectRoot(detectedRoot?: string): Promise<string | undefined> {
    if (detectedRoot) {
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: 'Use detected project root',
            description: detectedRoot,
            root: detectedRoot,
          },
          {
            label: 'Choose another folder',
            description: 'Select the code project directory',
            root: '',
          },
        ],
        { placeHolder: 'Code project root differs from docs. Select a project directory.' }
      );
      if (!pick) return undefined;
      if (pick.root) return pick.root;
    }

    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Project Directory',
    });

    const selected = folders?.[0]?.fsPath;
    if (!selected) return undefined;

    if (!await isExistingDirectory(selected)) {
      vscode.window.showErrorMessage('Selected path is not a directory.');
      return undefined;
    }

    return selected;
  }

  private async tryGitRoot(startPath: string): Promise<string | undefined> {
    try {
      return await runGit(startPath, ['rev-parse', '--show-toplevel']);
    } catch {
      return undefined;
    }
  }

  private async collectCommitContext(projectRoot: string): Promise<CommitContext | undefined> {
    let sha: string;
    try {
      sha = await runGit(projectRoot, ['rev-parse', 'HEAD']);
    } catch {
      vscode.window.showErrorMessage('No Git commit found. Commit your changes first.');
      return undefined;
    }

    const subject = await runGit(projectRoot, ['log', '-1', '--pretty=%s']);
    const body = await runGit(projectRoot, ['log', '-1', '--pretty=%b']);
    const stats = await runGit(projectRoot, ['show', '--stat', '--oneline', '--no-color', 'HEAD']);

    // Hardening: include --root so initial commit works.
    const changedFilesRaw = await runGit(projectRoot, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      'HEAD',
    ]);

    const changedFiles = changedFilesRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      // Hardening: ignore clearly unsafe paths to avoid odd git object spec/path edge cases.
      .filter((p) => isSafeRepoRelativePath(p));

    if (changedFiles.length === 0) {
      vscode.window.showErrorMessage('No files found in the current commit.');
      return undefined;
    }

    const testFiles = changedFiles.filter((filePath) => isTestPath(filePath));
    const otherFiles = changedFiles.filter((filePath) => !isTestPath(filePath));

    const testContexts: FileContext[] = [];
    const diffContexts: FileContext[] = [];

    const omittedTestFiles: string[] = [];
    const omittedOtherFiles: string[] = [];

    const testFilesToInclude = testFiles.slice(0, MAX_TEST_FILES);
    omittedTestFiles.push(...testFiles.slice(MAX_TEST_FILES));

    const otherFilesToInclude = otherFiles.slice(0, MAX_OTHER_FILES);
    omittedOtherFiles.push(...otherFiles.slice(MAX_OTHER_FILES));

    // Collect test context first (prefer full content; fall back to diff if not available).
    for (let i = 0; i < testFilesToInclude.length; i += 1) {
      const filePath = testFilesToInclude[i];
      const content = await this.getFileContentAtCommit(projectRoot, filePath, MAX_FILE_CHARS);
      if (content) {
        testContexts.push(content);
        continue;
      }
      const diff = await this.getFileDiffAtCommit(projectRoot, filePath, MAX_DIFF_CHARS);
      if (diff) {
        testContexts.push({
          filePath,
          content: diff.content,
          truncated: diff.truncated,
        });
      }
    }

    // Then collect diffs for other files.
    for (let i = 0; i < otherFilesToInclude.length; i += 1) {
      const filePath = otherFilesToInclude[i];
      const diff = await this.getFileDiffAtCommit(projectRoot, filePath, MAX_DIFF_CHARS);
      if (diff) {
        diffContexts.push(diff);
      }
    }

    const shortSha = sha.slice(0, 8);

    return {
      sha,
      shortSha,
      subject,
      body,
      stats,
      changedFiles,
      testFiles,
      otherFiles,
      testContexts,
      diffContexts,
      omittedTestFiles,
      omittedOtherFiles,
    };
  }

  private async getFileContentAtCommit(
    projectRoot: string,
    filePath: string,
    maxChars: number
  ): Promise<FileContext | undefined> {
    // Hardening: avoid weird object-spec edge cases by rejecting unsafe paths.
    if (!isSafeRepoRelativePath(filePath)) return undefined;

    try {
      const content = await runGit(projectRoot, ['show', `HEAD:${filePath}`]);

      // Binary detection: git show may still output binary; NUL is a decent heuristic.
      if (content.includes('\u0000')) {
        return {
          filePath,
          content: '[binary content omitted]',
          truncated: false,
        };
      }

      const truncated = truncateText(content, maxChars);
      return {
        filePath,
        content: truncated.text,
        truncated: truncated.truncated,
      };
    } catch {
      return undefined;
    }
  }

  private async getFileDiffAtCommit(
    projectRoot: string,
    filePath: string,
    maxChars: number
  ): Promise<FileContext | undefined> {
    if (!isSafeRepoRelativePath(filePath)) return undefined;

    try {
      const diff = await runGit(projectRoot, [
        'show',
        '--patch',
        '--no-color',
        '--format=',
        'HEAD',
        '--',
        filePath,
      ]);
      if (!diff) return undefined;

      const truncated = truncateText(diff, maxChars);
      return {
        filePath,
        content: truncated.text,
        truncated: truncated.truncated,
      };
    } catch {
      return undefined;
    }
  }

  private async generateMarkdown(commitContext: CommitContext): Promise<string | undefined> {
    const config = getAiSelectionConfig();
    const customConfig = getCustomProviderConfig();

    const { models, pickedModel } = await resolveModelCandidates(config);
    logger.debug('Starting documentation generation.', {
      provider: config.provider,
      vendor: config.vendor,
      modelId: config.modelId,
    });

    const systemPrompt = buildSystemPrompt();

    // Redact secrets before sending anywhere.
    const userPrompt = clampText(
      redactSecrets(buildUserPrompt(commitContext)),
      MAX_PROMPT_CHARS
    );

    // VS Code LM hardening: send proper system role when available, else fold into user message.
    const SystemCtor = (vscode.LanguageModelChatMessage as any).System;
    const messages: vscode.LanguageModelChatMessage[] = SystemCtor
      ? [SystemCtor(systemPrompt), vscode.LanguageModelChatMessage.User(userPrompt)]
      : [vscode.LanguageModelChatMessage.User(`${systemPrompt}\n\n${userPrompt}`)];

    const errors: string[] = [];
    const recordError = (message?: string) => {
      const cleaned = sanitizeUiError(message);
      if (cleaned && !errors.includes(cleaned)) {
        errors.push(cleaned);
      }
    };

    const attemptCustom = async (): Promise<string | undefined> => {
      logger.debug('Attempting generation via custom provider.', {
        baseUrl: customConfig.baseUrl,
        model: customConfig.model,
      });
      const result = await this.generateWithCustomProvider(systemPrompt, userPrompt, customConfig);
      recordError(result.error);
      if (result.error) {
        logger.debug('Custom provider attempt failed.', { error: result.error });
      }
      return result.result;
    };

    const attemptVsCode = async (): Promise<string | undefined> => {
      logger.debug('Attempting generation via VS Code models.', {
        modelCount: models.length,
        pickedModelId: pickedModel?.id,
      });
      const result = await this.generateWithVsCodeModels(messages, models, pickedModel);
      recordError(result.error);
      if (result.error) {
        logger.debug('VS Code model attempt failed.', { error: result.error });
      }
      return result.result;
    };

    // Prefer provider selection, then fall back to the other.
    if (config.provider === 'custom') {
      const customResult = await attemptCustom();
      if (customResult) return customResult;

      const vscodeResult = await attemptVsCode();
      if (vscodeResult) return vscodeResult;
    } else {
      const vscodeResult = await attemptVsCode();
      if (vscodeResult) return vscodeResult;

      const customResult = await attemptCustom();
      if (customResult) return customResult;
    }

    const suffix = errors.length ? ` ${errors.join(' ')}` : '';
    await showGenerationError(`Failed to generate documentation.${suffix}`, config, customConfig);
    return undefined;
  }

  private async generateWithVsCodeModels(
    messages: vscode.LanguageModelChatMessage[],
    models: vscode.LanguageModelChat[],
    pickedModel?: vscode.LanguageModelChat
  ): Promise<{ result?: string; error?: string }> {
    if (models.length === 0) {
      return { error: 'No VS Code language models are available.' };
    }

    let lastError: string | undefined;

    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      logger.debug('Sending request to VS Code model.', {
        modelId: model.id,
        vendor: (model as any).vendor,
        name: (model as any).name,
      });

      const canSend = this.context.languageModelAccessInformation.canSendRequest(model);
      if (canSend === false) {
        lastError = 'Language model access is not allowed for this extension.';
        logger.warn('VS Code model access denied.', { modelId: model.id });
        continue;
      }

      try {
        const response = await model.sendRequest(messages, {});
        let result = '';

        for await (const chunk of response.text) {
          result += chunk;
          if (result.length > MAX_PROMPT_CHARS) {
            // Prevent runaway streaming from hanging the extension host on huge outputs.
            break;
          }
        }

        const trimmed = result.trim();
        if (!trimmed) {
          lastError = 'VS Code model returned an empty response.';
          logger.warn('VS Code model returned an empty response.', { modelId: model.id });
          continue;
        }

        if (pickedModel && pickedModel.id === model.id) {
          await persistModelSelection(model);
        }

        return { result: trimmed };
      } catch (error: any) {
        lastError = error?.message ? String(error.message) : String(error);
        logger.debug('VS Code model request failed.', { modelId: model.id, error: lastError });
      }
    }

    return { error: lastError || 'Failed to generate documentation with VS Code models.' };
  }

  private async generateWithCustomProvider(
    systemPrompt: string,
    userPrompt: string,
    customConfig: CustomProviderConfig
  ): Promise<{ result?: string; error?: string }> {
    if (!isCustomProviderReady(customConfig)) {
      logger.warn('Custom provider is not configured.', {
        baseUrl: customConfig.baseUrl,
        model: customConfig.model,
      });
      return { error: 'Custom provider is not configured (missing base URL or model).' };
    }

    if (customConfig.model?.trim().toLowerCase() === 'auto') {
      logger.warn('Custom provider model is set to "auto"; some providers require an explicit model id.', {
        baseUrl: customConfig.baseUrl,
      });
    }

    // Hardening: only allow http/https URLs.
    let endpoint: string;
    try {
      endpoint = resolveCustomEndpoint(
        customConfig.baseUrl as string,
        customConfig.chatEndpoint
      );
      const u = new URL(endpoint);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { error: 'Custom provider URL must use http or https.' };
      }
    } catch (e: any) {
      return { error: sanitizeUiError(e?.message || String(e)) };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (customConfig.apiKey) {
      headers.Authorization = `Bearer ${customConfig.apiKey}`;
    }

    const payload = {
      model: customConfig.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
    };

    const timeoutMs = customConfig.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

    try {
      logger.debug('Sending custom provider request.', {
        endpoint,
        model: customConfig.model,
        timeoutMs,
        payloadChars: JSON.stringify(payload).length,
      });
      const response = await postJson(endpoint, headers, payload, timeoutMs);
      if (response?.error?.message) {
        logger.warn('Custom provider returned an error payload.', {
          endpoint,
          model: customConfig.model,
          error: sanitizeUiError(response.error.message),
        });
        return { error: `Custom provider error: ${sanitizeUiError(response.error.message)}` };
      }

      const content = extractCompletionContent(response);
      if (!content) {
        logger.warn('Custom provider returned an empty response.', {
          endpoint,
          model: customConfig.model,
        });
        return { error: 'Custom provider returned an empty response.' };
      }

      logger.debug('Custom provider response received.', {
        endpoint,
        model: customConfig.model,
      });
      return { result: String(content).trim() };
    } catch (error: any) {
      logger.error('Custom provider request failed.', {
        endpoint,
        model: customConfig.model,
        error: error?.message ? String(error.message) : String(error),
      });
      return { error: sanitizeUiError(error?.message ? String(error.message) : String(error)) };
    }
  }

  private async createTopicFile(title: string, content: string): Promise<string> {
    const topicsDir = this.documentManager.getTopicsDirectory();

    const baseFileName = TopicsService.formatTitleAsFilename(title);
    const safeFileName = sanitizeFilename(baseFileName);

    // Ensure final write target stays inside topicsDir.
    const uniqueFileName = await ensureUniqueFileName(topicsDir, safeFileName);
    const filePath = path.join(topicsDir, uniqueFileName);

    const topicsDirResolved = path.resolve(topicsDir);
    const filePathResolved = path.resolve(filePath);
    if (!filePathResolved.startsWith(`${topicsDirResolved}${path.sep}`) && filePathResolved !== topicsDirResolved) {
      throw new Error('Refused to write file outside topics directory.');
    }

    await FileService.writeNewFile(filePath, content);
    return uniqueFileName;
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error: any) {
    const stderr = error?.stderr ? String(error.stderr) : '';
    const message = stderr || error?.message || 'Git command failed';
    throw new Error(message);
  }
}

async function isExistingDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

function isTestPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(normalized)) return true;
  if (/\.(test|spec)\.[^/]+$/.test(normalized)) return true;
  return /(^|\/)[^/]+_(test|spec)\.[^/]+$/.test(normalized);
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated after ${maxChars} chars]`,
    truncated: true,
  };
}

function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated for safety after ${maxChars} chars]`;
}

function sanitizeAscii(text: string): string {
  // Normalize and strip non-ASCII; also strip control chars except tab/newline.
  const normalized = text.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  return normalized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function extractTitle(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (match && match[1]) return match[1].trim();
  return fallback;
}

function ensureTitleHeading(markdown: string, title: string): string {
  const trimmed = markdown.trimStart();
  if (/^#\s+.+/.test(trimmed)) return markdown;
  return `# ${title}\n\n${trimmed}`;
}

function sanitizeFilename(fileName: string): string {
  // Hardening: prevent path traversal and weird dotfiles.
  const base = path.basename(fileName || '');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '-');

  const ensuredMd = cleaned.toLowerCase().endsWith('.md') ? cleaned : `${cleaned}.md`;
  const safe = ensuredMd.replace(/^\.+/, ''); // drop leading dots

  if (!safe || safe === 'md' || safe === '.md') return 'commit-doc.md';
  if (safe === '.' || safe === '..') return 'commit-doc.md';
  if (safe.includes('/') || safe.includes('\\')) return 'commit-doc.md';

  return safe;
}

async function ensureUniqueFileName(directory: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const baseName = fileName.slice(0, fileName.length - ext.length);

  let candidate = fileName;
  let counter = 2;

  // Hardening: never allow separators.
  candidate = path.basename(candidate);

  while (await FileService.fileExists(path.join(directory, candidate))) {
    candidate = path.basename(`${baseName}-${counter}${ext}`);
    counter += 1;
  }

  return candidate;
}

async function resolveModelCandidates(config: AiSelectionConfig): Promise<{
  models: vscode.LanguageModelChat[];
  pickedModel?: vscode.LanguageModelChat;
}> {
  const allModels = await vscode.lm.selectChatModels();
  const models: vscode.LanguageModelChat[] = [];
  const seen = new Set<string>();
  let pickedModel: vscode.LanguageModelChat | undefined;

  const addModel = (model: vscode.LanguageModelChat | undefined) => {
    if (!model || !model.id || seen.has(model.id)) return;
    seen.add(model.id);
    models.push(model);
  };

  if (config.modelId) {
    addModel(allModels.find((model) => model.id === config.modelId));
  }

  if (config.provider === 'copilot') {
    const copilotModels = allModels.filter((model) => model.vendor === 'copilot');
    copilotModels.forEach(addModel);

    if (copilotModels.length === 0 && config.allowModelPicker && allModels.length > 0) {
      pickedModel = await promptModelSelection(
        allModels,
        'Copilot is not available. Select another model (e.g., Codex) to continue.'
      );
      addModel(pickedModel);
    }
  } else if (config.vendor) {
    allModels.filter((model) => model.vendor === config.vendor).forEach(addModel);
  }

  allModels.forEach(addModel);

  return { models, pickedModel };
}

function getAiSelectionConfig(): AiSelectionConfig {
  const config = vscode.workspace.getConfiguration('authord');
  const providerRaw = config.get<string>('ai.provider', 'copilot');
  const provider = providerRaw === 'vscode' || providerRaw === 'custom'
    ? (providerRaw as AiProvider)
    : 'copilot';

  const vendor = config.get<string>('ai.vendor', '').trim();
  const modelId = config.get<string>('ai.modelId', '').trim();
  const allowModelPicker = config.get<boolean>('ai.allowModelPicker', true);

  return {
    provider,
    vendor: vendor || undefined,
    modelId: modelId || undefined,
    allowModelPicker,
  };
}

function getCustomProviderConfig(): CustomProviderConfig {
  const config = vscode.workspace.getConfiguration('authord');
  const baseUrl = config.get<string>('ai.custom.baseUrl', '').trim();
  const model = config.get<string>('ai.custom.model', '').trim();
  const chatEndpoint = config.get<string>('ai.custom.chatEndpoint', '').trim();
  const timeoutMsSetting = config.get<number>('ai.custom.requestTimeoutMs', REQUEST_TIMEOUT_MS);
  const apiKeySetting = config.get<string>('ai.custom.apiKey', '').trim();
  const apiKeyEnv = getCustomApiKeyFromEnv();
  const apiKey = apiKeySetting || apiKeyEnv;

  return {
    baseUrl: baseUrl || undefined,
    model: model || undefined,
    apiKey: apiKey || undefined,
    chatEndpoint: chatEndpoint || undefined,
    requestTimeoutMs: normalizeTimeout(timeoutMsSetting),
  };
}

function getCustomApiKeyFromEnv(): string | undefined {
  const candidates = [
    'AUTHORD_AI_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
  ];

  for (const key of candidates) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }

  return undefined;
}

function isCustomProviderReady(config: CustomProviderConfig): boolean {
  return Boolean((config.chatEndpoint || config.baseUrl) && config.model);
}

function normalizeTimeout(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const safe = Math.round(value);
  if (safe < 1000) return 1000;
  if (safe > 300000) return 300000;
  return safe;
}

async function promptModelSelection(
  models: vscode.LanguageModelChat[],
  placeHolder: string
): Promise<vscode.LanguageModelChat | undefined> {
  const items = models.map((model) => ({
    label: model.name,
    description: model.vendor ? `vendor: ${model.vendor}` : undefined,
    detail: `${model.family} ${model.version} · ${model.id}`,
    model,
  }));

  const selected = await vscode.window.showQuickPick(items, { placeHolder });
  return selected?.model;
}

async function persistModelSelection(model: vscode.LanguageModelChat): Promise<void> {
  const config = vscode.workspace.getConfiguration('authord');
  await Promise.all([
    config.update('ai.provider', 'vscode', vscode.ConfigurationTarget.Global),
    config.update('ai.vendor', model.vendor, vscode.ConfigurationTarget.Global),
    config.update('ai.modelId', model.id, vscode.ConfigurationTarget.Global),
  ]);
}

function hasExplicitAiConfig(config: AiSelectionConfig, customConfig: CustomProviderConfig): boolean {
  if (config.modelId || config.vendor) return true;
  if (config.provider !== 'copilot') return true;
  return Boolean(customConfig.baseUrl || customConfig.model || customConfig.apiKey);
}

async function showGenerationError(
  message: string,
  config: AiSelectionConfig,
  customConfig: CustomProviderConfig
): Promise<void> {
  const shouldOfferSettings = config.provider === 'custom'
    ? !isCustomProviderReady(customConfig)
    : !hasExplicitAiConfig(config, customConfig);

  const safeMessage = sanitizeUiError(message) ?? 'Authord encountered an error.';

  if (shouldOfferSettings) {
    const action = await vscode.window.showErrorMessage(safeMessage, 'Configure AI', 'Open Settings');
    if (action === 'Configure AI') {
      await vscode.commands.executeCommand('authordExtension.configureAI');
      return;
    }
    if (action === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'authord.ai');
    }
    return;
  }

  vscode.window.showErrorMessage(safeMessage);
}

function resolveCustomEndpoint(baseUrl: string, override?: string): string {
  const overrideTrimmed = override?.trim().replace(/\/+$/, '');
  if (overrideTrimmed) return overrideTrimmed;

  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!path || path === '/') {
      logger.debug('Custom provider base URL has no path; inserting /v1.', { baseUrl: trimmed });
      return `${trimmed}/v1/chat/completions`;
    }
  } catch {
    // Ignore URL parsing errors and fall back to default behavior.
  }

  return `${trimmed}/chat/completions`;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number
): Promise<any> {
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch (error: any) {
      reject(new Error(`Invalid custom provider URL: ${error?.message || String(error)}`));
      return;
    }

    const isHttp = target.protocol === 'http:';
    const isHttps = target.protocol === 'https:';
    if (!isHttp && !isHttps) {
      reject(new Error('Custom provider URL must use http or https.'));
      return;
    }

    const options: https.RequestOptions = {
      method: 'POST',
      hostname: target.hostname,
      port: target.port ? Number(target.port) : undefined,
      path: `${target.pathname}${target.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    };

    const transport = isHttp ? http : https;

    const req = transport.request(options, (res) => {
      res.setEncoding('utf8');

      let data = '';
      let bytes = 0;

      res.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Custom provider response too large.'));
          return;
        }
        data += chunk;
      });

      res.on('end', () => {
        const status = res.statusCode ?? 0;

        if (status >= 200 && status < 300) {
          if (!data.trim()) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Custom provider returned invalid JSON.'));
          }
          return;
        }

        const statusMessage = res.statusMessage ? ` ${res.statusMessage}` : '';
        const detail = data ? ` ${clampText(stripControlChars(data), 500)}` : '';
        logger.error('Custom provider responded with an error status.', {
          url,
          status,
          statusMessage: res.statusMessage,
          detail,
        });
        reject(new Error(`Custom provider error (${status}${statusMessage}).${detail}`));
      });
    });

    req.setTimeout(timeoutMs, () => {
      logger.error('Custom provider request timed out.', { url, timeoutMs });
      req.destroy(new Error('Custom provider request timed out.'));
    });

    req.on('error', (error) => {
      logger.error('Custom provider request errored.', {
        url,
        error: error?.message ? String(error.message) : String(error),
      });
      reject(error);
    });
    req.write(payload);
    req.end();
  });
}

function extractCompletionContent(response: any): string | undefined {
  if (response?.error?.message) return undefined;

  const choices = response?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    const messageContent = first?.message?.content;
    if (typeof messageContent === 'string') return messageContent;

    const textContent = first?.text;
    if (typeof textContent === 'string') return textContent;
  }

  if (typeof response?.content === 'string') return response.content;

  return undefined;
}

function buildSystemPrompt(): string {
  return [
    'You are Authord, a documentation generator embedded in VS Code.',
    'Task: produce a Markdown document that explains the current commit.',
    'Use this order: analyze test context first, then code changes, then any remaining files.',
    'Output rules:',
    '- Markdown only (no surrounding code fences).',
    '- Use ASCII characters only (no smart quotes, bullets, or emojis).',
    '- Start with a single H1 heading.',
    '- Keep sections concise and engineer-focused.',
    'Content requirements:',
    '- Summarize behavior and user-facing impact.',
    '- Call out API, CLI, or config changes explicitly.',
    '- Describe test coverage and any gaps.',
    '- Provide usage or migration notes when relevant.',
    '- Include a "Documentation Tree Placement" section suggesting where this page belongs in the Authord TOC.',
    '- If information is missing, say so rather than guessing.',
  ].join('\n');
}

function buildUserPrompt(context: CommitContext): string {
  const fileList = formatFileList(context.changedFiles, MAX_FILE_LIST);
  const testFileList = formatFileList(context.testFiles, MAX_FILE_LIST);
  const otherFileList = formatFileList(context.otherFiles, MAX_FILE_LIST);

  const testContextBlocks = context.testContexts.map((entry) => {
    const header = `--- Test file: ${entry.filePath}${entry.truncated ? ' (truncated)' : ''} ---`;
    return `${header}\n${entry.content}`;
  }).join('\n\n');

  const diffBlocks = context.diffContexts.map((entry) => {
    const header = `--- Diff: ${entry.filePath}${entry.truncated ? ' (truncated)' : ''} ---`;
    return `${header}\n${entry.content}`;
  }).join('\n\n');

  const omittedTestsNote = context.omittedTestFiles.length
    ? `Omitted test files (${context.omittedTestFiles.length}): ${context.omittedTestFiles.join(', ')}`
    : 'Omitted test files: none';

  const omittedOtherNote = context.omittedOtherFiles.length
    ? `Omitted code files (${context.omittedOtherFiles.length}): ${context.omittedOtherFiles.join(', ')}`
    : 'Omitted code files: none';

  return [
    `Commit SHA: ${context.sha}`,
    `Subject: ${context.subject}`,
    context.body ? `Body:\n${context.body}` : 'Body: (none)',
    '',
    'Changed files:',
    fileList,
    '',
    'Test files:',
    testFileList,
    '',
    'Other files:',
    otherFileList,
    '',
    'Commit stats:',
    context.stats || '(none)',
    '',
    omittedTestsNote,
    omittedOtherNote,
    '',
    'TEST CONTEXT (analyze first):',
    testContextBlocks || '(no test content available)',
    '',
    'CODE CHANGES (analyze after tests):',
    diffBlocks || '(no diff content available)',
  ].join('\n');
}

function formatFileList(files: string[], maxFiles: number): string {
  if (files.length === 0) return '- (none)';
  const visible = files.slice(0, maxFiles);
  const omitted = files.length - visible.length;
  const lines = visible.map((file) => `- ${file}`);
  if (omitted > 0) lines.push(`- ...${omitted} more files omitted`);
  return lines.join('\n');
}

/**
 * Hardening: avoid weird paths (newlines/NUL, absolute paths, traversal, object-spec confusion).
 * This also reduces risk of using "HEAD:<path>" with pathological strings.
 */
function isSafeRepoRelativePath(p: string): boolean {
  if (!p) return false;
  if (p.includes('\u0000') || p.includes('\n') || p.includes('\r')) return false;

  const normalized = p.replace(/\\/g, '/');

  if (normalized.startsWith('/')) return false;
  if (normalized.includes('../') || normalized.includes('/..') || normalized === '..') return false;
  if (normalized.includes(':/')) return false; // helps avoid some object-spec confusion in HEAD:<path>
  if (normalized.trim() !== normalized) return false;

  // Keep it reasonably bounded.
  if (normalized.length > 500) return false;

  return true;
}

function stripControlChars(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function sanitizeUiError(message?: string): string | undefined {
  if (!message) return undefined;

  // Redact secrets and clamp to avoid leaking big blobs into UI.
  const cleaned = redactSecrets(stripControlChars(String(message)));
  const compact = cleaned.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;

  return compact.length > MAX_ERROR_CHARS
    ? `${compact.slice(0, MAX_ERROR_CHARS)}...`
    : compact;
}

/**
 * Very lightweight secret redaction (best-effort).
 * Goal: prevent obvious accidental leaks in prompts and error messages.
 */
function redactSecrets(text: string): string {
  let out = text;

  const patterns: Array<{ re: RegExp; replace: string }> = [
    // PEM blocks
    { re: /-----BEGIN [A-Z0-9 _-]+-----[\s\S]*?-----END [A-Z0-9 _-]+-----/g, replace: '[REDACTED_PEM]' },

    // Common API key env assignments
    { re: /\b(OPENAI_API_KEY|DEEPSEEK_API_KEY|AUTHORD_AI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID)\s*=\s*[^\s'"]+/g, replace: '$1=[REDACTED]' },

    // Bearer tokens
    { re: /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, replace: 'Authorization: Bearer [REDACTED]' },

    // Generic "api_key"/"token"/"secret" JSON-ish assignments
    { re: /("?(api[_-]?key|token|secret|password)"?\s*[:=]\s*")([^"]+)(")/gi, replace: '$1[REDACTED]$4' },
    { re: /(\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*)([^\s'"]+)/gi, replace: '$1[REDACTED]' },

    // GitHub tokens (classic + fine-grained)
    { re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, replace: '[REDACTED_GITHUB_TOKEN]' },

    // Slack tokens (basic forms)
    { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: '[REDACTED_SLACK_TOKEN]' },
  ];

  for (const p of patterns) {
    out = out.replace(p.re, p.replace);
  }

  return out;
  
}
