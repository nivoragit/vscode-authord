import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import RenderService from '../RenderService';
import type { DocumentationManager } from '../../managers/DocumentationManager';
import RegistryService from './RegistryService';
import type { TriStateRegistry, TriStateTopic } from './types';
import { getLogger } from '../LoggerService';

const execFileAsync = promisify(execFile);

type DiffViewPayload = {
  topicId: string;
  topicName: string;
  codeSummary: string;
  localHtml: string;
  localPath: string;
  snapshot?: {
    version: number;
    synced_at: string;
    body: string;
  };
};

export default class TriStateDiffView {
  private static currentPanel: TriStateDiffView | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly renderService = new RenderService();
  private readonly registryService: RegistryService;
  private readonly logger = getLogger();
  private readonly disposables: vscode.Disposable[] = [];
  private currentTopicId: string | undefined;
  private currentLocalPath: string | undefined;

  static createOrShow(
    context: vscode.ExtensionContext,
    workspaceRoot: string,
    documentManager: DocumentationManager
  ): TriStateDiffView {
    if (TriStateDiffView.currentPanel) {
      TriStateDiffView.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      return TriStateDiffView.currentPanel;
    }

    const localResourceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [];
    localResourceRoots.push(context.extensionUri);

    const panel = vscode.window.createWebviewPanel(
      'authordTriStateDiff',
      'Authord Tri-State Diff',
      vscode.ViewColumn.Two,
      { enableScripts: true, localResourceRoots }
    );

    TriStateDiffView.currentPanel = new TriStateDiffView(
      panel,
      workspaceRoot,
      documentManager
    );
    return TriStateDiffView.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly workspaceRoot: string,
    private readonly documentManager: DocumentationManager
  ) {
    this.panel = panel;
    this.registryService = new RegistryService(workspaceRoot);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((msg) => {
        if (!this.currentTopicId) return;
        switch (msg?.command) {
          case 'openLocal':
            void this.openLocalDoc();
            break;
          case 'runHarmonize':
            void vscode.commands.executeCommand('authord.harmonizeTopic', { topic: this.currentTopicId });
            break;
          case 'syncSnapshot':
            void vscode.commands.executeCommand('authord.syncConfluenceSnapshots', { topic: this.currentTopicId });
            break;
          default:
            break;
        }
      })
    );
  }

  async showTopic(topicId: string): Promise<void> {
    const payload = await this.buildPayload(topicId);
    this.currentTopicId = payload.topicId;
    this.currentLocalPath = payload.localPath;
    this.panel.title = `Tri-State Diff: ${payload.topicName}`;
    this.panel.webview.html = this.buildHtml(payload);
    this.panel.reveal(vscode.ViewColumn.Two);
  }

  private async buildPayload(topicId: string): Promise<DiffViewPayload> {
    const registry = await this.registryService.loadRegistry();
    const topic = resolveTopic(registry, topicId);
    if (!topic) {
      throw new Error(`Topic "${topicId}" not found in registry.`);
    }

    const localPath = await this.resolveLocalPath(topic);
    const localDoc = await vscode.workspace.openTextDocument(localPath);
    const localHtml = await this.renderService.renderDocument(localDoc, {
      documentManager: this.documentManager,
      renderMode: 'simple',
    });

    const codeSummary = await this.buildCodeDiffSummary(topic);
    const snapshot = await this.loadSnapshot(topic);

    return {
      topicId: topic.id,
      topicName: topic.name || topic.id,
      codeSummary,
      localHtml,
      localPath,
      snapshot,
    };
  }

  private async resolveLocalPath(topic: TriStateTopic): Promise<string> {
    const relative = topic.local_state?.path;
    if (!relative) {
      throw new Error(`Topic ${topic.id} does not have a local_state.path.`);
    }
    const topicsDir = this.documentManager.getTopicsDirectory();
    return path.join(topicsDir, relative);
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
        const diff = await this.readGitDiffSummary(relative);
        if (diff.trim()) {
          return `File: ${relative}\n${diff}`;
        }
        return `File: ${relative}\nNo git diff detected.`;
      })
    );
    return summaries.join('\n\n');
  }

  private async readGitDiffSummary(relativePath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--stat', '--', relativePath], {
        cwd: this.workspaceRoot,
      });
      return stdout ?? '';
    } catch (error) {
      this.logger.debug('Git diff summary unavailable.', error);
      return '';
    }
  }

  private async loadSnapshot(topic: TriStateTopic): Promise<DiffViewPayload['snapshot']> {
    const pageId = topic.remote_state?.confluence_page_id;
    if (!pageId) return undefined;

    const snapshotDir = path.join(this.workspaceRoot, '_authord_output', 'confluence_snapshots');
    const latestPath = path.join(snapshotDir, `${pageId}.latest.json`);
    if (!fs.existsSync(latestPath)) return undefined;

    try {
      const raw = await fs.promises.readFile(latestPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        version: Number(parsed?.version ?? parsed?.confluence_version ?? 0),
        synced_at: String(parsed?.fetched_at ?? parsed?.synced_at ?? ''),
        body: String(parsed?.body ?? ''),
      };
    } catch (error) {
      this.logger.warn('Failed to read Confluence snapshot.', error);
      return undefined;
    }
  }

  private async openLocalDoc(): Promise<void> {
    if (!this.currentLocalPath) return;
    const doc = await vscode.workspace.openTextDocument(this.currentLocalPath);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  }

  private buildHtml(payload: DiffViewPayload): string {
    const webview = this.panel.webview;
    const nonce = createNonce();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    ].join('; ');

    const remoteBody = payload.snapshot?.body
      ? escapeHtml(payload.snapshot.body)
      : 'No snapshot available.';
    const remoteMeta = payload.snapshot
      ? `v${payload.snapshot.version} • ${payload.snapshot.synced_at || 'unknown sync time'}`
      : 'Sync required.';

    const syncButton = payload.snapshot
      ? ''
      : `<button class="action" data-action="syncSnapshot">Sync Required</button>`;

    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editor-background);
      }
      .layout {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        height: 100vh;
      }
      .pane {
        border-right: 1px solid var(--vscode-editorWidget-border);
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .pane:last-child {
        border-right: none;
      }
      .pane-header {
        padding: 10px 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        background: var(--vscode-sideBar-background);
      }
      .pane-body {
        padding: 12px;
        overflow: auto;
        height: 100%;
      }
      .code-block {
        white-space: pre-wrap;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        line-height: 1.4;
        background: var(--vscode-textBlockQuote-background);
        border: 1px solid var(--vscode-editorWidget-border);
        padding: 10px;
        border-radius: 6px;
      }
      .actions {
        display: flex;
        gap: 8px;
      }
      .action {
        border: 1px solid var(--vscode-button-border);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
      }
      .action.secondary {
        background: transparent;
        color: var(--vscode-foreground);
      }
      .meta {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        padding: 0 12px 8px;
      }
      .markdown-body {
        max-width: 100%;
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <section class="pane">
        <div class="pane-header">Code Diff Summary</div>
        <div class="pane-body">
          <pre class="code-block">${escapeHtml(payload.codeSummary)}</pre>
        </div>
      </section>
      <section class="pane">
        <div class="pane-header">
          <span>Local Markdown</span>
          <div class="actions">
            <button class="action secondary" data-action="openLocal">Open Local Doc</button>
            <button class="action" data-action="runHarmonize">Run Harmonize</button>
          </div>
        </div>
        <div class="pane-body markdown-body">
          ${payload.localHtml}
        </div>
      </section>
      <section class="pane">
        <div class="pane-header">
          <span>Remote Snapshot</span>
          <div class="actions">
            ${syncButton}
          </div>
        </div>
        <div class="meta">${escapeHtml(remoteMeta)}</div>
        <div class="pane-body">
          <pre class="code-block">${remoteBody}</pre>
        </div>
      </section>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-action');
          vscode.postMessage({ command: action });
        });
      });
    </script>
  </body>
</html>`;
  }

  dispose(): void {
    TriStateDiffView.currentPanel = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
    this.panel.dispose();
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createNonce(): string {
  return Buffer.from(`${Date.now()}-${Math.random()}-${os.hostname()}`).toString('base64');
}
