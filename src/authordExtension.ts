/*
    Presentation Layer
    ├─ Command Handlers
    └─ UI Components
*/
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import * as os from 'os';
import { focusOrShowPreview } from './utils/VsCodePreviewHelperFunctions';
import DocumentationItem from './services/DocumentationItem';
import TopicsItem from './services/TopicsItem';
import TopicsService from './services/TopicsService';
import DocumentationService from './services/DocumentationService';
import CommitDocumentationService from './services/CommitDocumentationService';
import { authortdSchemaValidator, writersideSchemaValidator } from './validators/schemaValidators';
import AuthordDocumentManager from './managers/AuthordDocumentManager';
import WriterSideDocumentManager from './managers/WriterSideDocumentManager';
import DocumentationProvider from './services/DocumentationProvider';
import TopicsDragAndDropController from './services/TopicsDragAndDropController';
import TopicsProvider from './services/TopicsProvider';
import { DocumentationManager } from './managers/DocumentationManager';
import { AuthordPreview } from './AuthordPreview';
import RenderService, { type PreviewRenderMode } from './services/RenderService';
import { InstanceProfile } from './utils/types';
import DocumentIndexService from './services/agentic/documentIndexService';
import { getVectorConfig } from './services/agentic/vectorConfig';
import ConfluencePublishService from './services/ConfluencePublishService';
import TriStateBootstrapService from './services/triState/TriStateBootstrapService';
import SentinelService from './services/triState/SentinelService';
import RegistryService from './services/triState/RegistryService';
import BlueprintDiffService from './services/triState/BlueprintDiffService';
import IntegrationPlanWriter from './services/triState/IntegrationPlanWriter';
import RegistryBootstrapService from './services/triState/RegistryBootstrapService';
import HarmonizeService from './services/triState/HarmonizeService';
import ConfluenceSyncService from './services/triState/ConfluenceSyncService';
import TriStateDiffView from './services/triState/TriStateDiffView';
import RunTrackerService from './services/triState/RunTrackerService';
import type { TriStateStatus } from './services/triState/types';
import LoggerService, { getLogger } from './services/LoggerService';

export default class Authord {
  private commandsRegistered = false;
  private useCustomPreview = true;
  private listenersSubscribed = false;
  private providersRegistered = false;
  private setupConfigWatchers = false;
  private documentationProvider: DocumentationProvider | undefined;
  private topicsProvider: TopicsProvider | undefined;
  private configCode = 0;
  documentManager: DocumentationManager | undefined;
  currentFileName = '';
  currentTopicTitle = '';
  schemaPath = '';
  private fsModule: typeof fs;
  private notifier: typeof vscode.window;
  private commandExecutor: typeof vscode.commands;
  private preview: AuthordPreview | undefined;
  private configFiles = ['authord.config.json', 'writerside.cfg'];
  private renderService: RenderService;
  private previewRenderMode: PreviewRenderMode = 'simple';
  private indexService: DocumentIndexService | undefined;
  private sentinelDiagnostics: vscode.DiagnosticCollection | undefined;
  private triStateStatusItem: vscode.StatusBarItem | undefined;
  private logger: LoggerService;
  private editorScrollSyncThrottleTimer: ReturnType<typeof setTimeout> | undefined;
  private editorScrollSyncUnlockTimer: ReturnType<typeof setTimeout> | undefined;
  private editorScrollSyncLock = false;
  private pendingEditorScroll:
    | { line: number; heading?: { title: string; line: number }; anchor?: string; ratio: number }
    | undefined;
  private lastEditorScrollLine: number | undefined;
  private lastEditorScrollAnchor: string | undefined;
  private lastEditorEditAt = 0;

  constructor(
    private context: vscode.ExtensionContext,
    private workspaceRoot: string,
    fsModule: typeof fs = fs,
    notifier: typeof vscode.window = vscode.window,
    commandExecutor: typeof vscode.commands = vscode.commands,
    logger: LoggerService = getLogger()
  ) {
    if (!workspaceRoot) {
      throw new Error('Workspace root is required to initialize the extension.');
    }
    this.fsModule = fsModule;
    this.notifier = notifier;
    this.commandExecutor = commandExecutor;
    this.renderService = new RenderService();
    this.logger = logger;
  }

  /**
   * Main async initialization flow:
   *  1. Checks config files
   *  2. Creates providers and registers them if config is valid
   *  3. Registers commands and listeners
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.refreshConfig();
      this.registerCreateProjectCommand();
      await this.checkConfigFiles();

      if (!this.configCode) {
        this.notifier.showErrorMessage('Config file does not exist');
        return;
      }

      const config = vscode.workspace.getConfiguration('authord');
      this.useCustomPreview = config.get<boolean>('useCustomPreview', true);
      this.previewRenderMode = config.get<PreviewRenderMode>('previewRenderMode', 'simple');

      if (this.documentManager) {
        this.topicsProvider = new TopicsProvider(new TopicsService(this.documentManager), this.workspaceRoot);
        this.documentationProvider = new DocumentationProvider(
          new DocumentationService(this.documentManager),
          this.topicsProvider
        );
        await this.ensureIndexService();
        this.registerProviders();
        this.documentationProvider.refresh();
        this.providersRegistered = true;
      }

      this.registerCommands();
      this.commandsRegistered = true;
      this.subscribeListeners();
      this.listenersSubscribed = true;
    } catch (error: any) {
      this.notifier.showErrorMessage(`Failed to initialize extension: ${error.message}`);
      this.commandExecutor.executeCommand('setContext', 'authord.configExists', false);
    }
  }

  /**
   * Reinitializes the extension if config changes or is recreated.
   */
  public async reinitialize(): Promise<void> {
    try {
      this.logger.refreshConfig();
      await this.checkConfigFiles();

      if (!this.configCode) {
        this.notifier.showErrorMessage('Config file does not exist');
      } else {
        try {
          if (this.configCode === 1) {
            const configManager = this.documentManager as WriterSideDocumentManager;
            await writersideSchemaValidator(this.schemaPath, configManager.ihpData, configManager.getInstances());
          } else if (this.configCode === 2) {
            await authortdSchemaValidator(this.schemaPath, (this.documentManager as AuthordDocumentManager).configData!);
          }
        } catch (error: any) {
          if (process.env.NODE_ENV !== 'test') {
            this.commandExecutor.executeCommand('workbench.action.reloadWindow');
          }
          this.notifier.showErrorMessage('Failed to initialize extension');
          this.notifier.showErrorMessage(`Invalid configuration file: ${error.message}`);
        }

        // Read configuration setting for custom preview
        const config = vscode.workspace.getConfiguration('authord');
        this.useCustomPreview = config.get<boolean>('useCustomPreview', true);
        this.previewRenderMode = config.get<PreviewRenderMode>('previewRenderMode', 'simple');
        if (this.documentManager) {
          await this.ensureIndexService();
        }
        // If custom preview is disabled and an instance exists, dispose it.
        if (!this.useCustomPreview && this.preview) {
          this.preview.dispose();
          this.preview = undefined;
        }

        if (!this.documentationProvider || !this.topicsProvider) {
          this.topicsProvider = new TopicsProvider(new TopicsService(this.documentManager!), this.workspaceRoot);
          this.documentationProvider = new DocumentationProvider(
            new DocumentationService(this.documentManager!),
            this.topicsProvider
          );
        }

        if (this.documentManager) {
          if (!this.providersRegistered) {
            this.registerProviders();
            this.providersRegistered = true;
          }

          if (!this.commandsRegistered) {
            this.registerCommands();
            this.commandsRegistered = true;
          }

          if (!this.listenersSubscribed) {
            this.subscribeListeners();
            this.listenersSubscribed = true;
          }

          this.documentManager.reload();
          this.renderService.invalidateDocset();
          this.preview?.updateContext({
            documentManager: this.documentManager,
            renderMode: this.previewRenderMode,
          });
        }

        this.documentationProvider?.refresh();
        this.notifier.showInformationMessage('Extension reinitialized');
      }
    } catch (error: any) {
      this.notifier.showErrorMessage(`Failed to reinitialize extension: ${error.message}`);
      this.commandExecutor.executeCommand('setContext', 'authord.configExists', false);
    }
  }

  private async ensureIndexService(): Promise<void> {
    if (!this.documentManager) return;
    if (!this.indexService) {
      try {
        this.indexService = await DocumentIndexService.create(
          this.context,
          this.documentManager,
          this.workspaceRoot
        );
      } catch (error: any) {
        this.logger.warn('Vector index unavailable.', error);
        this.notifier.showWarningMessage(`Vector index unavailable: ${error.message}`);
      }
      return;
    }
    this.indexService.updateDocumentManager(this.documentManager);
  }

  public getIndexService(): DocumentIndexService | undefined {
    return this.indexService;
  }

  private async publishDocs(): Promise<void> {
    if (!this.documentManager) {
      this.notifier.showErrorMessage('Documentation manager is not initialized.');
      return;
    }

    const config = vscode.workspace.getConfiguration('authord');
    const confluenceEnabled = config.get<boolean>('confluence.enabled', true);
    if (!confluenceEnabled) {
      this.notifier.showWarningMessage('Confluence publishing is disabled in settings.');
      return;
    }

    await this.ensureIndexService();
    const vectorConfig = getVectorConfig();

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Publishing documentation...' },
      async (progress) => {
        const report = (message: string) => progress?.report({ message });
        if (this.indexService && vectorConfig.enabled) {
          report('Updating vector index...');
          await this.indexService.indexAll(true);
        }

        report('Publishing to Confluence...');
        const confluenceService = new ConfluencePublishService(this.workspaceRoot);
        await confluenceService.publish();
      }
    );

    if (!vectorConfig.enabled) {
      this.notifier.showWarningMessage('Vector indexing is disabled; only Confluence was updated.');
    } else {
      this.notifier.showInformationMessage('Confluence and vector index updated.');
    }
  }

  /**
   * Subscribes to VSCode events and updates model data accordingly.
   */
  private subscribeListeners(): void {
    this.context.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        const tabGroups = vscode.window.tabGroups.all;
        if (
          editors.length === 0 &&
          tabGroups.length === 2 &&
          tabGroups[0].tabs.length === 0 &&
          tabGroups[1].tabs[0].label.startsWith('Preview')
        ) {
          this.commandExecutor.executeCommand('workbench.action.closeAllEditors');
        }
      }),

      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // If the doc is markdown and we have a known currentDocId from topics, update the currentFileName/currentTopicTitle
        if (
          editor?.document.languageId === 'markdown' &&
          this.topicsProvider &&
          this.topicsProvider.currentDocId
        ) {
          let topicTitle = editor.document.lineAt(0).text.trim();
          if (!topicTitle) {
            for (let i = 1; i < editor.document.lineCount; i += 1) {
              topicTitle = editor.document.lineAt(i).text.trim();
              if (topicTitle) break;
            }
          }
          if (topicTitle.startsWith('#') && !topicTitle.startsWith('##')) {
            const fileName = path.basename(editor.document.fileName);
            if (this.currentFileName !== fileName) {
              this.currentFileName = fileName;
              this.currentTopicTitle = topicTitle.substring(1).trim() || fileName;
            }
          }
        }
      }),

      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (doc.languageId === 'markdown' && this.topicsProvider && this.topicsProvider.currentDocId) {
          let topicTitle = doc.lineAt(0).text.trim();
          if (!topicTitle) {
            for (let i = 1; i < doc.lineCount; i += 1) {
              topicTitle = doc.lineAt(i).text.trim();
              if (topicTitle) break;
            }
          }
          if (!topicTitle) return;
          if (topicTitle.startsWith('# ')) {
            topicTitle = topicTitle.substring(1).trim();
          } else {
            topicTitle = '';
          }
          const fileName = path.basename(doc.fileName);
          if (this.currentTopicTitle === topicTitle && this.currentFileName === fileName) return;
          const matchingItem = this.topicsProvider.findTopicItemByFilename(fileName);
          if (!matchingItem) return;
          matchingItem.title = topicTitle || `<${fileName}>`;
          this.topicsProvider.renameTopic(
            matchingItem.topic,
            topicTitle || `<${fileName}>`
          );
          this.currentTopicTitle = topicTitle;
        }

        if (this.previewRenderMode === 'docset' && this.documentManager) {
          this.renderService.invalidateDocset(this.documentManager.getConfigPath());
        }

        if (this.useCustomPreview && this.preview && this.isPreviewableDocument(doc)) {
          this.preview.update(doc);
        }

        if (this.indexService && this.isPreviewableDocument(doc)) {
          const vectorConfig = getVectorConfig();
          if (vectorConfig.enabled && vectorConfig.autoIndex) {
            await this.indexService.indexDocument(doc.uri.fsPath, doc.getText());
          }
        }

        await this.runSentinelCheck(doc);

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor?.document === doc) {
          await this.updateTriStateEditorIndicator(activeEditor);
        }
      }),

      // NEW: Auto-update custom preview when the active text editor changes
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (this.useCustomPreview && editor && this.isPreviewableDocument(editor.document)) {
          if (!this.preview) {
            this.preview = AuthordPreview.createOrShow(this.context, this.renderService, {
              documentManager: this.documentManager,
              renderMode: this.previewRenderMode,
            });
          } else {
            this.preview.updateContext({
              documentManager: this.documentManager,
              renderMode: this.previewRenderMode,
            });
          }
          this.preview.update(editor.document);
        }
        if (editor) {
          void this.updateTriStateEditorIndicator(editor);
          void this.runSentinelCheck(editor.document);
        }
      }),

      // NEW: Auto-update custom preview when the document content changes
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (
          this.useCustomPreview &&
          this.preview &&
          vscode.window.activeTextEditor?.document === e.document &&
          this.isPreviewableDocument(e.document)
        ) {
          this.lastEditorEditAt = Date.now();
          this.preview.update(e.document);
        }
      }),

      // NEW: Sync preview on editor scroll using the top visible line anchor.
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        const editor = event.textEditor;
        if (!this.useCustomPreview || !this.preview || !editor || !this.isPreviewableDocument(editor.document)) {
          return;
        }
        if (this.editorScrollSyncLock) return;

        const visible = editor.visibleRanges[0];
        if (!visible) return;

        const anchorInfo = this.findEditorScrollAnchor(editor.document, visible.start.line);
        const line = anchorInfo.line + 1;
        const heading = this.findForwardHeadingAnchor(editor.document, anchorInfo.line);
        const anchor = anchorInfo.anchor;
        const ratio =
          editor.document.lineCount > 1
            ? anchorInfo.line / (editor.document.lineCount - 1)
            : 0;
        const sameLine = this.lastEditorScrollLine === line;
        const sameAnchor = this.lastEditorScrollAnchor === anchor;
        if (sameLine && sameAnchor) return;

        this.pendingEditorScroll = { line, heading, anchor, ratio };
        if (this.editorScrollSyncThrottleTimer) return;

        this.editorScrollSyncThrottleTimer = setTimeout(() => {
          this.editorScrollSyncThrottleTimer = undefined;
          const pending = this.pendingEditorScroll;
          this.pendingEditorScroll = undefined;
          if (!pending || !this.preview) return;

          this.lastEditorScrollLine = pending.line;
          this.lastEditorScrollAnchor = pending.anchor;
          this.preview.postMessage({
            command: 'syncScroll',
            line: pending.line,
            heading: pending.heading,
            anchor: pending.anchor,
            ratio: pending.ratio,
          });
        }, 120);
      })
    );
  }

  private ensureSentinelDiagnostics(): vscode.DiagnosticCollection {
    if (!this.sentinelDiagnostics) {
      this.sentinelDiagnostics = vscode.languages.createDiagnosticCollection('authord-sentinel');
      this.context.subscriptions.push(this.sentinelDiagnostics);
    }
    return this.sentinelDiagnostics;
  }

  private async runSentinelCheck(doc: vscode.TextDocument): Promise<void> {
    const config = vscode.workspace.getConfiguration('authord');
    const enabled = config.get<boolean>('sentinel.enabled', true);
    const mode = config.get<string>('sentinel.mode', 'quick');
    if (!enabled || mode === 'off') {
      this.sentinelDiagnostics?.delete(doc.uri);
      return;
    }
    if (!this.documentManager) return;

    try {
      await this.fsModule.access(this.workspaceRoot);
    } catch {
      return;
    }

    try {
      const registryService = new RegistryService(this.workspaceRoot);
      const registry = await registryService.loadRegistry();
      const sentinel = new SentinelService(this.workspaceRoot);
      const refs = sentinel.findSymbolRefsForDocument(registry, doc.uri.fsPath);
      if (refs.length === 0) {
        this.sentinelDiagnostics?.delete(doc.uri);
        return;
      }

      const autoMark = config.get<boolean>('sentinel.autoMarkRegistry', false);
      let registryChanged = false;
      const diagnostics: vscode.Diagnostic[] = [];

      for (const ref of refs) {
        const drift = sentinel.checkDrift(ref.topic, doc.getText(), ref.symbol);
        if (drift !== 'Drifted') continue;

        const range = this.findSentinelRange(doc, ref.symbolName);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Authord: documentation drift detected for topic ${ref.topic.id}.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = 'authord.sentinel';
        diagnostic.code = ref.topic.id;
        diagnostics.push(diagnostic);

        if (autoMark && ref.topic.tri_state !== 'DRIFTED') {
          ref.topic.tri_state = 'DRIFTED';
          registryChanged = true;
        }
      }

      if (diagnostics.length === 0) {
        this.sentinelDiagnostics?.delete(doc.uri);
        return;
      }

      if (autoMark && registryChanged) {
        await registryService.saveRegistry(registry);
      }
      this.ensureSentinelDiagnostics().set(doc.uri, diagnostics);
    } catch (error: any) {
      this.logger.warn('Sentinel drift check failed.', error);
    }
  }

  private findSentinelRange(doc: vscode.TextDocument, symbolName?: string): vscode.Range {
    if (!symbolName) return new vscode.Range(0, 0, 0, 0);
    const text = doc.getText();
    const index = this.findExportSignatureIndex(text, symbolName);
    if (index === undefined) return new vscode.Range(0, 0, 0, 0);
    const position = doc.positionAt(index);
    return doc.lineAt(position.line).range;
  }

  private findExportSignatureIndex(text: string, symbolName: string): number | undefined {
    const patterns = [
      new RegExp(`export\\s+(?:declare\\s+)?function\\s+${symbolName}\\b`),
      new RegExp(`export\\s+default\\s+(?:async\\s+)?function\\s+${symbolName}\\b`),
      new RegExp(`export\\s+(?:abstract\\s+)?class\\s+${symbolName}\\b`),
      new RegExp(`export\\s+interface\\s+${symbolName}\\b`),
      new RegExp(`export\\s+enum\\s+${symbolName}\\b`),
      new RegExp(`export\\s+type\\s+${symbolName}\\b`),
      new RegExp(`export\\s+(?:const|let|var)\\s+${symbolName}\\b`),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match && match.index !== undefined) {
        return match.index;
      }
    }
    return undefined;
  }

  private ensureTriStateStatusItem(): vscode.StatusBarItem {
    if (!this.triStateStatusItem) {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
      item.name = 'Authord Tri-State Status';
      item.command = 'authord.showTopicStatus';
      this.triStateStatusItem = item;
      this.context.subscriptions.push(item);
    }
    return this.triStateStatusItem;
  }

  private hideTriStateStatusItem(): void {
    if (this.triStateStatusItem) {
      this.triStateStatusItem.hide();
    }
  }

  private formatTriStateStatus(status: TriStateStatus): {
    label: string;
    icon: string;
    color?: vscode.ThemeColor;
  } {
    switch (status) {
      case 'SYNCED':
        return { label: 'Synced', icon: '$(check)', color: new vscode.ThemeColor('charts.green') };
      case 'DRIFTED':
        return { label: 'Drifted', icon: '$(warning)', color: new vscode.ThemeColor('charts.yellow') };
      case 'DRAFT':
        return { label: 'Draft', icon: '$(edit)', color: new vscode.ThemeColor('charts.blue') };
      case 'MISSING':
        return { label: 'Missing', icon: '$(error)', color: new vscode.ThemeColor('charts.red') };
      default:
        return { label: 'Unknown', icon: '$(question)' };
    }
  }

  private async updateTriStateEditorIndicator(editor?: vscode.TextEditor): Promise<void> {
    if (!editor || !this.documentManager) {
      this.hideTriStateStatusItem();
      return;
    }

    const config = vscode.workspace.getConfiguration('authord');
    const showIndicator = config.get<boolean>('ui.showTriStateEditorIndicator', true) ?? false;
    if (!showIndicator || editor.document.languageId !== 'markdown') {
      this.hideTriStateStatusItem();
      return;
    }

    const topicsDir = this.documentManager.getTopicsDirectory();
    const relativePath = path.relative(topicsDir, editor.document.uri.fsPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      this.hideTriStateStatusItem();
      return;
    }

    try {
      const registryService = new RegistryService(this.workspaceRoot);
      const registry = await registryService.loadRegistry();
      const status = registryService.getTopicStatusFromRegistry(relativePath, registry);
      const formatted = this.formatTriStateStatus(status);
      const item = this.ensureTriStateStatusItem();
      item.text = `${formatted.icon} Authord: ${formatted.label}`;
      item.tooltip = `Authord topic ${relativePath} is ${formatted.label}.`;
      item.color = formatted.color;
      item.show();
    } catch (error: any) {
      this.logger.warn('Tri-state editor indicator update failed.', error);
      this.hideTriStateStatusItem();
    }
  }

  /**
   * Registers the DocumentationProvider and TopicsProvider as tree data providers,
   * and creates their corresponding Tree Views.
   */
  private registerProviders(): void {
    if (!this.topicsProvider || !this.documentationProvider) {
      this.notifier.showErrorMessage('topicsProvider or documentationProvider not created');
      return;
    }
    vscode.window.registerTreeDataProvider('documentationsView', this.documentationProvider);
    vscode.window.registerTreeDataProvider('topicsView', this.topicsProvider);
    const topicsView = vscode.window.createTreeView('topicsView', {
      treeDataProvider: this.topicsProvider,
      dragAndDropController: new TopicsDragAndDropController(this.topicsProvider),
    });
    const docView = vscode.window.createTreeView('documentationsView', {
      treeDataProvider: this.documentationProvider,
    });
    this.context.subscriptions.push(docView, topicsView);
    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider('emptyProjectView', {
        getTreeItem: (element: vscode.TreeItem) => element,
        getChildren: () => [new vscode.TreeItem('No projects found')],
      })
    );
  }

  /**
   * Registers the createProject command separately to ensure it is available even before config check.
   */
  private registerCreateProjectCommand(): void {
    this.context.subscriptions.push(
      this.commandExecutor.registerCommand('extension.createProject', async () => {
        this.notifier.showInformationMessage('Creating a new project...');
        await this.createConfigFile();
        await this.documentationProvider!.addDoc();
      })
    );
  }

  /**
   * Registers various commands for managing Topics and Documents in the extension.
   */
  private registerCommands(): void {
    if (!this.topicsProvider || !this.documentationProvider) {
      this.notifier.showErrorMessage('topicsProvider or documentationProvider not created');
      return;
    }

    const selectInstanceCommand = this.commandExecutor.registerCommand(
      'authordDocsExtension.selectInstance',
      (docId: string) => {
        const doc = this.documentManager!.getInstances().find((d: any) => d.id === docId);
        if (!doc) {
          this.notifier.showErrorMessage(`No document found with id ${docId}`);
          return;
        }
        const tocElements = doc['toc-elements'];
        this.topicsProvider!.refresh(tocElements, docId);
      }
    );

    const moveTopicCommand = this.commandExecutor.registerCommand(
      'extension.moveTopic',
      async (sourceTopicId: string, targetTopicId: string) => {
        await this.topicsProvider!.moveTopic(sourceTopicId, targetTopicId);
      }
    );

    this.context.subscriptions.push(selectInstanceCommand);
    this.context.subscriptions.push(moveTopicCommand);

    this.context.subscriptions.push(
      // Updated openMarkdownFile command to open doc in column one and show custom preview if enabled
      this.commandExecutor.registerCommand('authordExtension.openMarkdownFile', async (resourceUri: vscode.Uri) => {
        const doc = await vscode.workspace.openTextDocument(resourceUri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

        if (this.useCustomPreview) {
          this.preview = AuthordPreview.createOrShow(this.context, this.renderService, {
            documentManager: this.documentManager,
            renderMode: this.previewRenderMode,
          });
          this.preview.update(doc);
        } else {
          await focusOrShowPreview();
        }
      }),

      this.commandExecutor.registerCommand('extension.addChildTopic', (item: TopicsItem) => {
        this.topicsProvider!.addChildTopic(item);
      }),

      this.commandExecutor.registerCommand('extension.addContextMenuChildTopic', (item: TopicsItem) => {
        this.topicsProvider!.addChildTopic(item);
      }),

      this.commandExecutor.registerCommand('extension.addContextMenuTopic', (item: TopicsItem) => {
        this.topicsProvider!.addSiblingTopic(item);
      }),

      this.commandExecutor.registerCommand('extension.ContextMenuSetasStartPage', (item: TopicsItem) => {
        this.topicsProvider!.setAsStartPage(item.topic);
      }),

      this.commandExecutor.registerCommand('extension.deleteTopic', (item: TopicsItem) => {
        this.topicsProvider!.deleteTopic(item);
      }),

      this.commandExecutor.registerCommand('extension.deleteContextMenuTopic', (item: TopicsItem) => {
        this.topicsProvider!.deleteTopic(item);
      }),

      this.commandExecutor.registerCommand('extension.renameContextMenuTopic', (item: TopicsItem) => {
        this.topicsProvider!.editTopicTitle(item);
      }),

      this.commandExecutor.registerCommand('extension.addDocumentation', () => {
        this.documentationProvider!.addDoc();
      }),

      this.commandExecutor.registerCommand('authordExtension.generateCommitDocs', async () => {
        await this.generateCommitDocs();
      }),

      this.commandExecutor.registerCommand('authordExtension.configureAI', async () => {
        await this.configureAiProvider();
      }),

      this.commandExecutor.registerCommand('authord.initializeRegistry', async () => {
        await this.initializeTriStateRegistryFromTopics();
      }),

      this.commandExecutor.registerCommand('authord.generateTriStateIntegrationPlan', async () => {
        await this.generateTriStateIntegrationPlan();
      }),

      this.commandExecutor.registerCommand('authord.showTopicStatus', async () => {
        await this.showTopicStatusForActiveEditor();
      }),

      this.commandExecutor.registerCommand('authord.harmonizeTopic', async (item?: TopicsItem) => {
        await this.harmonizeTopic(item);
      }),

      this.commandExecutor.registerCommand('authord.syncConfluenceSnapshots', async (item?: TopicsItem) => {
        await this.syncConfluenceSnapshots(item);
      }),

      this.commandExecutor.registerCommand('authord.openTriStateDiff', async (item?: TopicsItem) => {
        await this.openTriStateDiff(item);
      }),

      this.commandExecutor.registerCommand('authord.showLastRunReport', async () => {
        await this.showLastRunReport();
      }),

      this.commandExecutor.registerCommand('authordExtension.initTriStateRegistry', async () => {
        await this.initializeTriStateRegistry();
      }),

      this.commandExecutor.registerCommand('authordExtension.installCodexSkill', async () => {
        await this.installCodexSkill();
      }),

      this.commandExecutor.registerCommand('authordExtension.publishDocs', async () => {
        await this.publishDocs();
      }),

      this.commandExecutor.registerCommand('authordExtension.indexDocs', async () => {
        if (!this.documentManager) {
          this.notifier.showErrorMessage('Documentation manager is not initialized.');
          return;
        }
        await this.ensureIndexService();
        if (!this.indexService) {
          this.notifier.showErrorMessage('Vector indexing is unavailable.');
          return;
        }
        const vectorConfig = getVectorConfig();
        if (!vectorConfig.enabled) {
          this.notifier.showWarningMessage('Vector indexing is disabled in settings.');
          return;
        }
        try {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Indexing documentation...' },
            async (progress) => {
              progress?.report({ message: 'Preparing index...' });
              await this.indexService!.indexAll(true);
              progress?.report({ message: 'Finalizing index...' });
            }
          );
          this.notifier.showInformationMessage('Documentation index updated.');
        } catch (error: any) {
          this.logger.error('Documentation indexing failed.', error);
          const message = error?.message ? ` ${error.message}` : '';
          this.notifier.showErrorMessage(
            `Documentation indexing failed.${message} See Authord Logs for details.`
          );
        }
      }),

      this.commandExecutor.registerCommand('authordExtension.clearIndex', async () => {
        if (!this.indexService) {
          await this.ensureIndexService();
        }
        if (!this.indexService) {
          this.notifier.showErrorMessage('Vector indexing is unavailable.');
          return;
        }
        try {
          await this.indexService.clearIndex();
          this.notifier.showInformationMessage('Vector index cleared.');
        } catch (error: any) {
          this.logger.error('Vector index clear failed.', error);
          const message = error?.message ? ` ${error.message}` : '';
          this.notifier.showErrorMessage(`Vector index clear failed.${message} See Authord Logs for details.`);
        }
      }),

      this.commandExecutor.registerCommand('extension.reloadConfiguration', () => {
        this.reinitialize();
        this.topicsProvider?.refresh([]);
      }),

      this.commandExecutor.registerCommand('extension.addContextMenuDocumentation', () => {
        this.documentationProvider!.addDoc();
      }),

      this.commandExecutor.registerCommand('extension.deleteDocumentation', (item: DocumentationItem) => {
        this.documentationProvider!.deleteDoc(item);
      }),

      this.commandExecutor.registerCommand('extension.deleteContextMenuDocumentation', (item: DocumentationItem) => {
        this.documentationProvider!.deleteDoc(item);
      }),

      this.commandExecutor.registerCommand('extension.rootTopic', () => {
        this.topicsProvider!.addRootTopic();
      }),

      this.commandExecutor.registerCommand('extension.renameContextMenuDoc', (item: DocumentationItem) => {
        this.documentationProvider!.renameDoc(item);
      }),

      this.commandExecutor.registerCommand('extension.renameDoc', (item: DocumentationItem) => {
        this.documentationProvider!.renameDoc(item);
      }),
      this.commandExecutor.registerCommand(
        'authordExtension.onPreviewScrolled',
        (line: number, heading?: { title: string; line: number }, anchor?: string) => {
          const editor = vscode.window.activeTextEditor;
          if (editor && this.isPreviewableDocument(editor.document)) {
            if (Date.now() - this.lastEditorEditAt < 700) {
              return;
            }
            const safeLine = Number.isFinite(line) ? Math.round(line) : 1;
            const resolved = this.adjustLineFromHeading(editor.document, safeLine, heading);
            let targetLine = Math.max(1, Math.min(resolved ?? safeLine, editor.document.lineCount));
            if (anchor) {
              const anchoredLine = this.findLineByAnchor(editor.document, targetLine - 1, anchor);
              if (anchoredLine !== undefined) {
                targetLine = anchoredLine + 1;
              }
            }
            const position = new vscode.Position(targetLine - 1, 0);
            this.setEditorScrollSyncLock();
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
          }
        }
      )
    );
    this.commandsRegistered = true;
  }

  private async initializeTriStateRegistry(): Promise<void> {
    if (!this.documentManager) {
      this.notifier.showErrorMessage('Documentation manager is not initialized.');
      return;
    }

    try {
      const bootstrap = new TriStateBootstrapService(this.workspaceRoot, this.documentManager);
      const result = await bootstrap.bootstrapRegistry();
      if (result.addedTopics === 0) {
        this.notifier.showInformationMessage('Tri-State registry is already initialized.');
        return;
      }
      this.notifier.showInformationMessage(
        `Tri-State registry initialized with ${result.addedTopics} topics.`
      );
    } catch (error: any) {
      this.logger.error('Tri-State registry initialization failed.', error);
      const message = error?.message ? ` ${error.message}` : '';
      this.notifier.showErrorMessage(`Tri-State registry initialization failed.${message}`);
    }
  }

  private async initializeTriStateRegistryFromTopics(): Promise<void> {
    if (!this.documentManager) {
      this.notifier.showErrorMessage('Documentation manager is not initialized.');
      return;
    }

    try {
      const bootstrap = new RegistryBootstrapService(this.documentManager);
      const result = await bootstrap.bootstrapFromTopics(this.workspaceRoot);
      if (result.created) {
        this.notifier.showInformationMessage(
          `Tri-State registry created with ${result.topicsAdded} topics.`
        );
        return;
      }
      if (result.topicsAdded > 0) {
        this.notifier.showInformationMessage(
          `Tri-State registry updated with ${result.topicsAdded} new topics.`
        );
        return;
      }
      this.notifier.showInformationMessage('Tri-State registry already up to date.');
    } catch (error: any) {
      this.logger.error('Tri-State registry initialization failed.', error);
      const message = error?.message ? ` ${error.message}` : '';
      this.notifier.showErrorMessage(`Tri-State registry initialization failed.${message}`);
    }
  }

  private async generateTriStateIntegrationPlan(): Promise<void> {
    try {
      const diffService = new BlueprintDiffService(this.workspaceRoot);
      const blueprint = await diffService.loadBlueprint();
      const repoSignals = await diffService.scanRepo();
      const diffResult = diffService.diff(blueprint, repoSignals);
      const ordered = diffService.computeDependencyOrder(blueprint);
      const writer = new IntegrationPlanWriter(this.workspaceRoot, blueprint.name);
      await writer.writePlan(diffResult, ordered);
      this.notifier.showInformationMessage(
        'Tri-State integration plan generated at docs/architecture/tri-state-integration.md.'
      );
    } catch (error: any) {
      this.logger.error('Tri-State integration plan generation failed.', error);
      const message = error?.message ? ` ${error.message}` : '';
      this.notifier.showErrorMessage(`Tri-State integration plan generation failed.${message}`);
    }
  }

  private async showTopicStatusForActiveEditor(): Promise<void> {
    if (!this.documentManager) {
      this.notifier.showInformationMessage('Documentation manager is not initialized.');
      return;
    }

    const relativePath = this.getActiveTopicRelativePath();
    if (!relativePath) {
      this.notifier.showInformationMessage('Active editor is not an Authord topic file.');
      return;
    }

    try {
      const registryService = new RegistryService(this.workspaceRoot);
      const registry = await registryService.loadRegistry();
      const status = registryService.getTopicStatusFromRegistry(relativePath, registry);
      const formatted = this.formatTriStateStatus(status);
      this.notifier.showInformationMessage(`Authord topic ${relativePath}: ${formatted.label}.`);
    } catch (error: any) {
      this.logger.error('Topic status lookup failed.', error);
      const message = error?.message ? ` ${error.message}` : '';
      this.notifier.showErrorMessage(`Failed to resolve topic status.${message}`);
    }
  }

  private async harmonizeTopic(item?: TopicsItem): Promise<void> {
    if (!this.documentManager) {
      this.notifier.showErrorMessage('Documentation manager is not initialized.');
      return;
    }

    const topicId = item?.topic ?? this.getActiveTopicRelativePath();
    if (!topicId) {
      this.notifier.showInformationMessage('No topic selected to harmonize.');
      return;
    }

    try {
      const harmonizer = new HarmonizeService(this.workspaceRoot, this.documentManager);
      await harmonizer.harmonizeTopic(topicId);
    } catch (error: any) {
      this.logger.error('Topic harmonize failed.', error);
      const message = error?.message ? ` ${error.message}` : '';
      this.notifier.showErrorMessage(`Topic harmonize failed.${message}`);
    }
  }

  private async syncConfluenceSnapshots(item?: TopicsItem): Promise<void> {
    if (!this.documentManager) {
      this.notifier.showErrorMessage('Documentation manager is not initialized.');
      return;
    }

    const topicId = item?.topic ?? this.getActiveTopicRelativePath();
    const syncService = new ConfluenceSyncService(this.workspaceRoot);

    if (topicId) {
      try {
        const result = await syncService.syncTopic(topicId);
        this.notifier.showInformationMessage(
          `Confluence snapshot synced for ${topicId} (v${result.version}).`
        );
      } catch (error: any) {
        this.logger.error('Confluence snapshot sync failed.', error);
        const message = error?.message ? ` ${error.message}` : '';
        this.notifier.showErrorMessage(`Confluence snapshot sync failed.${message}`);
      }
      return;
    }

    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Sync all topics with Confluence IDs', value: 'all' },
        { label: 'Cancel', value: 'cancel' },
      ],
      { placeHolder: 'No topic selected. Choose a sync option.' }
    );
    if (!pick || pick.value !== 'all') return;

    try {
      const result = await syncService.syncAllTopics();
      if (result.synced === 0) {
        this.notifier.showInformationMessage('No topics synced. Check for configured Confluence IDs.');
        return;
      }
      this.notifier.showInformationMessage(
        `Confluence snapshots synced for ${result.synced} topic(s).`
      );
    } catch (error: any) {
      this.logger.error('Confluence snapshot sync failed.', error);
      const message = error?.message ? ` ${error.message}` : '';
      this.notifier.showErrorMessage(`Confluence snapshot sync failed.${message}`);
    }
  }

  private async openTriStateDiff(item?: TopicsItem): Promise<void> {
    if (!this.documentManager) {
      this.notifier.showErrorMessage('Documentation manager is not initialized.');
      return;
    }

    const topicId = item?.topic ?? this.getActiveTopicRelativePath();
    if (!topicId) {
      this.notifier.showInformationMessage('No topic selected to compare.');
      return;
    }

    try {
      const diffView = TriStateDiffView.createOrShow(this.context, this.workspaceRoot, this.documentManager);
      await diffView.showTopic(topicId);
    } catch (error: any) {
      this.logger.error('Tri-State diff view failed.', error);
      const message = error?.message ? ` ${error.message}` : '';
      this.notifier.showErrorMessage(`Tri-State diff view failed.${message}`);
    }
  }

  private async showLastRunReport(): Promise<void> {
    const tracker = new RunTrackerService(this.workspaceRoot);
    try {
      const lastPath = await tracker.getLastRunPath();
      if (!lastPath) {
        this.notifier.showInformationMessage('No Authord runs recorded yet.');
        return;
      }
      const run = await tracker.readRun(lastPath);
      const stepsSummary = run.steps
        .map((step) => {
          const duration = step.finished_at
            ? Math.max(0, Date.parse(step.finished_at) - Date.parse(step.started_at))
            : 0;
          const seconds = duration ? `${(duration / 1000).toFixed(1)}s` : 'pending';
          return `${step.step_id}:${step.status}(${seconds})`;
        })
        .join(', ');
      this.notifier.showInformationMessage(
        `Last run ${run.workflow_id} (${run.status}). Steps: ${stepsSummary}`
      );

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(lastPath));
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    } catch (error: any) {
      this.logger.error('Failed to open last run report.', error);
      const message = error?.message ? ` ${error.message}` : '';
      this.notifier.showErrorMessage(`Failed to open last run report.${message}`);
    }
  }

  private getActiveTopicRelativePath(): string | undefined {
    if (!this.documentManager) return undefined;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    const topicsDir = this.documentManager.getTopicsDirectory();
    const relativePath = path.relative(topicsDir, editor.document.uri.fsPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return undefined;
    }
    return relativePath;
  }

  private async generateCommitDocs(): Promise<void> {
    if (!this.documentManager) {
      this.notifier.showErrorMessage('Documentation manager is not initialized.');
      return;
    }

    const targetInstance = await this.resolveTargetInstance();
    if (!targetInstance) return;

    const generator = new CommitDocumentationService(
      this.context,
      this.documentManager,
      this.workspaceRoot
    );

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Authord: Generating documentation for current commit',
        cancellable: false,
      },
      async (progress) => {
        const report = (message: string) => progress?.report({ message });
        return generator.generateForHeadCommit(targetInstance, report);
      }
    );

    if (!result) return;

    this.topicsProvider?.refresh(targetInstance['toc-elements'], targetInstance.id);
    this.documentationProvider?.refresh();
    await this.commandExecutor.executeCommand('authordExtension.openMarkdownFile', result.filePath);
    this.notifier.showInformationMessage(`Generated documentation "${result.title}".`);
  }

  private async configureAiProvider(): Promise<void> {
    const selection = await this.notifier.showQuickPick(
      [
        {
          label: 'Copilot (default)',
          description: 'Use GitHub Copilot Chat models',
          provider: 'copilot',
        },
        {
          label: 'VS Code model',
          description: 'Pick from installed VS Code language models',
          provider: 'vscode',
        },
        {
          label: 'Custom OpenAI-compatible API',
          description: 'Configure DeepSeek or other endpoints',
          provider: 'custom',
        },
      ],
      {
        placeHolder: 'Choose the AI provider to generate documentation',
      }
    );

    if (!selection) return;

    switch (selection.provider) {
      case 'copilot':
        await this.configureCopilotProvider();
        break;
      case 'vscode':
        await this.configureVsCodeProvider();
        break;
      case 'custom':
        await this.configureCustomProvider();
        break;
      default:
        break;
    }

    const installChoice = await this.notifier.showInformationMessage(
      'Install the Authord Codex skill for Codex CLI?',
      'Install',
      'Not now'
    );
    if (installChoice === 'Install') {
      await this.installCodexSkill();
    }
  }

  private async configureCopilotProvider(): Promise<void> {
    const config = vscode.workspace.getConfiguration('authord');
    await Promise.all([
      config.update('ai.provider', 'copilot', vscode.ConfigurationTarget.Global),
      config.update('ai.vendor', '', vscode.ConfigurationTarget.Global),
      config.update('ai.modelId', '', vscode.ConfigurationTarget.Global),
    ]);
    this.notifier.showInformationMessage('Authord AI provider set to Copilot.');
  }

  private async configureVsCodeProvider(): Promise<void> {
    const models = await vscode.lm.selectChatModels();
    if (!models || models.length === 0) {
      this.notifier.showErrorMessage('No VS Code language models are available.');
      return;
    }

    const selection = await this.notifier.showQuickPick(
      models.map((model) => ({
        label: model.name,
        description: model.vendor ? `vendor: ${model.vendor}` : undefined,
        detail: `${model.family} ${model.version} · ${model.id}`,
        model,
      })),
      { placeHolder: 'Select a VS Code language model for Authord' }
    );

    if (!selection) return;

    const config = vscode.workspace.getConfiguration('authord');
    await Promise.all([
      config.update('ai.provider', 'vscode', vscode.ConfigurationTarget.Global),
      config.update('ai.vendor', selection.model.vendor || '', vscode.ConfigurationTarget.Global),
      config.update('ai.modelId', selection.model.id || '', vscode.ConfigurationTarget.Global),
    ]);

    this.notifier.showInformationMessage(`Authord AI model set to ${selection.label}.`);
  }

  private async configureCustomProvider(): Promise<void> {
    const config = vscode.workspace.getConfiguration('authord');
    const preset = await this.notifier.showQuickPick(
      [
        {
          label: 'DeepSeek',
          description: 'https://api.deepseek.com',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-reasoner',
        },
        {
          label: 'OpenAI-compatible (custom)',
          description: 'Enter your own base URL and model',
          baseUrl: '',
          model: '',
        },
      ],
      { placeHolder: 'Select a custom provider preset' }
    );

    if (!preset) return;

    const baseUrl = preset.baseUrl || await this.notifier.showInputBox({
      prompt: 'Custom API base URL (include /v1 if required)',
      value: config.get<string>('ai.custom.baseUrl', ''),
      ignoreFocusOut: true,
    });
    if (!baseUrl) {
      this.notifier.showErrorMessage('Custom provider base URL is required.');
      return;
    }

    const model = preset.model || await this.notifier.showInputBox({
      prompt: 'Model name (e.g., deepseek-reasoner)',
      value: config.get<string>('ai.custom.model', ''),
      ignoreFocusOut: true,
    });
    if (!model) {
      this.notifier.showErrorMessage('Custom provider model is required.');
      return;
    }

    const apiKey = await this.notifier.showInputBox({
      prompt: 'API key (optional, leave blank to keep existing or use env vars)',
      password: true,
      ignoreFocusOut: true,
    });
    if (apiKey === undefined) return;

    const updates: Array<Thenable<void>> = [
      config.update('ai.provider', 'custom', vscode.ConfigurationTarget.Global),
      config.update('ai.custom.baseUrl', baseUrl, vscode.ConfigurationTarget.Global),
      config.update('ai.custom.model', model, vscode.ConfigurationTarget.Global),
    ];

    if (apiKey.trim()) {
      updates.push(config.update('ai.custom.apiKey', apiKey.trim(), vscode.ConfigurationTarget.Global));
    }

    await Promise.all(updates);
    this.notifier.showInformationMessage('Authord AI provider set to custom endpoint.');
  }

  private getCodexHome(): string {
    const envHome = process.env.CODEX_HOME?.trim();
    if (envHome) return envHome;
    return path.join(os.homedir(), '.codex');
  }

  private async installCodexSkill(): Promise<void> {
    const sourceSkillPath = path.join(
      this.context.extensionUri.fsPath,
      'skills',
      'authord-docs',
      'SKILL.md'
    );
    const codexHome = this.getCodexHome();
    const targetDir = path.join(codexHome, 'skills', 'authord-docs');
    const targetSkillPath = path.join(targetDir, 'SKILL.md');

    const approval = await this.notifier.showInformationMessage(
      `Install Codex skill to ${targetDir}?`,
      'Install',
      'Cancel'
    );
    if (approval !== 'Install') return;

    try {
      await this.fsModule.access(sourceSkillPath);
      await this.fsModule.mkdir(targetDir, { recursive: true });
      await this.fsModule.copyFile(sourceSkillPath, targetSkillPath);
      this.notifier.showInformationMessage(`Codex skill installed to ${targetDir}.`);
    } catch (error: any) {
      const message = error?.message ? String(error.message) : String(error);
      this.notifier.showErrorMessage(`Failed to install Codex skill. ${message}`);
    }
  }

  private async resolveTargetInstance(): Promise<InstanceProfile | undefined> {
    if (!this.documentManager) return undefined;

    const instances = this.documentManager.getInstances();
    if (instances.length === 0) {
      this.notifier.showErrorMessage('No documentation instances available.');
      return undefined;
    }

    const currentDocId = this.topicsProvider?.currentDocId;
    if (currentDocId) {
      const current = instances.find((instance) => instance.id === currentDocId);
      if (current) return current;
    }

    if (instances.length === 1) {
      return instances[0];
    }

    const items: Array<vscode.QuickPickItem & { docId: string }> = instances.map(
      (instance) => ({
        label: instance.name || instance.id,
        description: instance.id,
        docId: instance.id,
      })
    );

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select documentation instance for commit docs',
    });

    if (!selection) return undefined;
    return instances.find((instance) => instance.id === selection.docId);
  }

  private isPreviewableDocument(doc: vscode.TextDocument): boolean {
    const filePath = doc.uri.fsPath.toLowerCase();
    return doc.languageId === 'markdown' || filePath.endsWith('.topic');
  }

  private setEditorScrollSyncLock(durationMs = 140): void {
    this.editorScrollSyncLock = true;
    if (this.editorScrollSyncUnlockTimer) {
      clearTimeout(this.editorScrollSyncUnlockTimer);
    }
    this.editorScrollSyncUnlockTimer = setTimeout(() => {
      this.editorScrollSyncUnlockTimer = undefined;
      this.editorScrollSyncLock = false;
    }, durationMs);
  }

  private findEditorScrollAnchor(
    doc: vscode.TextDocument,
    startLine: number,
    lookahead = 20
  ): { line: number; anchor?: string } {
    const maxLine = Math.min(doc.lineCount - 1, startLine + lookahead);
    for (let i = Math.max(0, startLine); i <= maxLine; i += 1) {
      const anchor = this.extractAnchorText(doc.lineAt(i).text);
      if (anchor) {
        return { line: i, anchor };
      }
    }
    return { line: Math.max(0, Math.min(startLine, doc.lineCount - 1)) };
  }

  private extractAnchorText(text: string): string | undefined {
    let out = text.trim();
    if (!out) return undefined;

    out = out.replace(/^>\s+/, '');
    out = out.replace(/^#{1,6}\s+/, '');
    out = out.replace(/^[-*+]\s+\[[ xX]\]\s+/, '');
    out = out.replace(/^[-*+]\s+/, '');
    out = out.replace(/^\d+\.\s+/, '');
    out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    out = out.replace(/<[^>]+>/g, '');
    out = out.replace(/[`*_~]/g, '');
    out = out.replace(/\s+/g, ' ').trim();

    if (out.length < 3) return undefined;
    return out.slice(0, 120);
  }

  private normalizeAnchor(text: string): string | undefined {
    const cleaned = this.extractAnchorText(text);
    if (!cleaned) return undefined;
    return cleaned.toLowerCase();
  }

  private findLineByAnchor(
    doc: vscode.TextDocument,
    startLine: number,
    anchor: string,
    lookahead = 40
  ): number | undefined {
    const needle = this.normalizeAnchor(anchor);
    if (!needle) return undefined;

    const start = Math.max(0, startLine - 5);
    const end = Math.min(doc.lineCount - 1, startLine + lookahead);
    for (let i = start; i <= end; i += 1) {
      const haystack = this.normalizeAnchor(doc.lineAt(i).text);
      if (haystack && haystack.includes(needle)) {
        return i;
      }
    }
    return undefined;
  }

  private findForwardHeadingAnchor(
    doc: vscode.TextDocument,
    startLine: number
  ): { title: string; line: number } | undefined {
    const headingRegex = /^(#{1,6})\s+(.+?)\s*$/;
    for (let i = startLine; i < doc.lineCount; i += 1) {
      const text = doc.lineAt(i).text;
      const match = headingRegex.exec(text);
      if (match) {
        const title = Authord.normalizeHeadingTitle(match[2]);
        if (title) {
          return { title, line: i + 1 };
        }
      }
    }
    return undefined;
  }

  private findHeadingLineByTitle(
    doc: vscode.TextDocument,
    title: string,
    startLine: number
  ): number | undefined {
    const headingRegex = /^(#{1,6})\s+(.+?)\s*$/;
    const normalizedTitle = Authord.normalizeHeadingTitle(title);
    if (!normalizedTitle) return undefined;
    for (let i = Math.max(0, startLine); i < doc.lineCount; i += 1) {
      const text = doc.lineAt(i).text;
      const match = headingRegex.exec(text);
      if (match && Authord.normalizeHeadingTitle(match[2]) === normalizedTitle) {
        return i;
      }
    }
    return undefined;
  }

  private adjustLineFromHeading(
    doc: vscode.TextDocument,
    line: number,
    heading?: { title: string; line: number }
  ): number | undefined {
    if (!heading || typeof heading.title !== 'string' || typeof heading.line !== 'number') {
      return undefined;
    }
    const startLine = Math.max(0, line - 1);
    const headingLine = this.findHeadingLineByTitle(doc, heading.title, startLine);
    if (headingLine === undefined) return undefined;
    const delta = line - heading.line;
    return headingLine + 1 + delta;
  }

  private static normalizeHeadingTitle(title: string): string {
    return title.replace(/\s+#+\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Creates a config file in the workspace and reinitializes.
   */
  private async createConfigFile(): Promise<void> {
    const filePath = path.join(this.workspaceRoot, this.configFiles[0]);
    this.documentManager = new AuthordDocumentManager(filePath);
    await (this.documentManager as AuthordDocumentManager).initializeConfigurationFile();
    await this.documentManager.reload();
    await this.reinitialize();
  }

  /**
   * Sets up watchers for a given config file in the workspace root.
   * Triggers `reinitialize()` on file changes, creation, or deletion.
   */
  public setupWatchers(fileName: string): void {
    const configWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceRoot, fileName)
    );

    configWatcher.onDidChange(async () => {
      await this.reinitialize();
      this.notifier.showInformationMessage('Config file has been modified.');
    });

    configWatcher.onDidCreate(async () => {
      await this.reinitialize();
      this.commandExecutor.executeCommand('setContext', 'authord.configExists', true);
      this.notifier.showInformationMessage('Config file has been created.');
    });

    configWatcher.onDidDelete(async () => {
      await this.reinitialize();
      this.commandExecutor.executeCommand('setContext', 'authord.configExists', false);
      if (process.env.NODE_ENV !== 'test') {
        this.commandExecutor.executeCommand('workbench.action.reloadWindow');
      }
      this.notifier.showInformationMessage('Config file has been deleted.');
    });

    this.context.subscriptions.push(configWatcher);
  }

  /**
   * Asynchronously checks for the presence of known config files (defined in configFiles array).
   * Returns:
   *  - 0 if no valid config file is found
   *  - 1 if an XML config file is found (configFiles[1])
   *  - 2 if an Authord config file is found (configFiles[0])
   */
  private async checkConfigFiles(): Promise<void> {
    if (this.documentManager && this.configCode) {
      return;
    }

    this.commandExecutor.executeCommand('setContext', 'authord.configExists', false);
    this.configCode = 0;

    let foundConfig = false;
    for (let i = 0; i < this.configFiles.length; i += 1) {
      const fileName = this.configFiles[i];
      const filePath = path.join(this.workspaceRoot, fileName);
      try {
        await this.fsModule.access(filePath);
        this.schemaPath = path.join(
          this.context.extensionPath,
          'schemas',
          'authord-config-schema.json'
        );

        if (fileName === this.configFiles[1]) {
          // XML config
          this.documentManager = new WriterSideDocumentManager(filePath);
          await this.documentManager.reload();
          this.commandExecutor.executeCommand('setContext', 'authord.configExists', true);

          if (!this.setupConfigWatchers) {
            this.setupWatchers(fileName);
            this.setupConfigWatchers = true;
          }

          // Validate against schema
          try {
            const configManager = this.documentManager as WriterSideDocumentManager;
            await writersideSchemaValidator(this.schemaPath, configManager.ihpData, configManager.getInstances());
          } catch (error: any) {
            if (process.env.NODE_ENV !== 'test') {
              this.commandExecutor.executeCommand('workbench.action.reloadWindow');
            }
            this.notifier.showErrorMessage('Failed to initialize extension');
            this.notifier.showErrorMessage(`Invalid configuration file: ${error.message}`);
            break;
          }

          this.configCode = 1;
          foundConfig = true;
        } else {
          // Authord config (default / fallback)
          this.documentManager = new AuthordDocumentManager(filePath);
          await this.documentManager.reload();
          this.commandExecutor.executeCommand('setContext', 'authord.configExists', true);

          if (!this.setupConfigWatchers) {
            this.setupWatchers(fileName);
            this.setupConfigWatchers = true;
          }

          try {
            await authortdSchemaValidator(this.schemaPath, (this.documentManager as AuthordDocumentManager).configData!);
          } catch (error: any) {
            this.notifier.showErrorMessage(`Failed to validate: ${error.message}`);
            break;
          }

          this.configCode = 2;
          foundConfig = true;
        }

        if (foundConfig) {
          break;
        }
      } catch {
        // Continue to next file if not found
      }
    }
  }
}
