/*
    Presentation Layer
    ├─ Command Handlers
    └─ UI Components
*/
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { configFiles, focusOrShowPreview } from './utils/helperFunctions';
import DocumentationItem from './services/DocumentationItem';
import TopicsItem from './services/TopicsItem';
import TopicsService from './services/TopicsService';
import DocumentationService from './services/DocumentationService';
import { authortdSchemaValidator, writersideSchemaValidator } from './validators/schemaValidators';
import AuthordDocumentManager from './managers/AuthordDocumentManager';
import WriterSideDocumentManager from './managers/WriterSideDocumentManager';
import DocumentationProvider from './services/DocumentationProvider';
import TopicsDragAndDropController from './services/TopicsDragAndDropController';
import TopicsProvider from './services/TopicsProvider';
import { DocumentationManager } from './managers/DocumentationManager';
import { AuthordPreview } from './AuthordPreview'; // NEW: Custom preview class

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


  constructor(
    private context: vscode.ExtensionContext,
    private workspaceRoot: string,
    fsModule: typeof fs = fs,
    notifier: typeof vscode.window = vscode.window,
    commandExecutor: typeof vscode.commands = vscode.commands
  ) {
    if (!workspaceRoot) {
      throw new Error('Workspace root is required to initialize InitializeExtension.');
    }
    this.fsModule = fsModule;
    this.notifier = notifier;
    this.commandExecutor = commandExecutor;
  }

  /**
   * Main async initialization flow:
   *  1. Checks config files
   *  2. Creates providers and registers them if config is valid
   *  3. Registers commands
   */
  public async initialize(): Promise<void> {
    try {
      this.registerCreateProjectCommand();
      await this.checkConfigFiles();

      if (!this.configCode) {
        this.notifier.showErrorMessage('config file does not exist');
        return;
      }
      
      if (this.documentManager) {
        this.topicsProvider = new TopicsProvider(new TopicsService(this.documentManager));
        this.documentationProvider = new DocumentationProvider(
          new DocumentationService(this.documentManager),
          this.topicsProvider
        );

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
      await this.checkConfigFiles();

      if (!this.configCode) {
        this.notifier.showErrorMessage('config file does not exist');
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

        if (vscode.workspace.getConfiguration('authord').get<boolean>('useCustomPreview', true)) {
          this.useCustomPreview = true;
        } else {
          this.useCustomPreview = false;
          if (this.preview) {
            this.preview = undefined;
          }
        }

        if (!this.documentationProvider || !this.topicsProvider) {
          this.topicsProvider = new TopicsProvider(new TopicsService(this.documentManager!));
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
        }

        this.documentationProvider?.refresh();
        this.notifier.showInformationMessage('extension reinitialized');
      }
    } catch (error: any) {
      this.notifier.showErrorMessage(`Failed to reinitialize extension: ${error.message}`);
      this.commandExecutor.executeCommand('setContext', 'authord.configExists', false);
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
        // Existing logic for topics and current document title sync.
        if (
          editor?.document.languageId === 'markdown' &&
          this.topicsProvider &&
          this.topicsProvider.currentDocId
        ) {
          let topicTitle = editor.document.lineAt(0).text.trim();
          if (!topicTitle) {
            for (let i = 1; i < editor.document.lineCount; i += 1) {
              topicTitle = editor.document.lineAt(i).text.trim();
              if (topicTitle) {
                break;
              }
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
              if (topicTitle) {
                break;
              }
            }
          }

          if (!topicTitle) {
            return;
          }

          if (topicTitle.startsWith('# ')) {
            topicTitle = topicTitle.substring(1).trim();
          } else {
            topicTitle = '';
          }

          const fileName = path.basename(doc.fileName);
          if (this.currentTopicTitle === topicTitle && this.currentFileName === fileName) {
            return;
          }

          const matchingItem = this.topicsProvider.findTopicItemByFilename(fileName);
          if (!matchingItem) {
            return;
          }

          matchingItem.title = topicTitle || `<${fileName}>`;
          this.topicsProvider.renameTopic(
            matchingItem.topic,
            topicTitle || `<${fileName}>`
          );
          this.currentTopicTitle = topicTitle;
        }
      }),

      // NEW: Update custom preview when the active text editor changes
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (this.useCustomPreview && this.preview && editor && editor.document.languageId === 'markdown') {
          this.preview.update(editor.document);
        }
      }),

      // NEW: Update custom preview when the document content changes
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.useCustomPreview && this.preview && vscode.window.activeTextEditor?.document === e.document && e.document.languageId === 'markdown') {
          this.preview.update(e.document);
        }
      })
    );
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
      // NEW: Updated openMarkdownFile command to use the custom preview
      this.commandExecutor.registerCommand('authordExtension.openMarkdownFile', async (resourceUri: vscode.Uri) => {
        const document = await vscode.workspace.openTextDocument(resourceUri);
        await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        if (this.useCustomPreview) {
          this.preview = AuthordPreview.createOrShow(this.context);
          this.preview.update(document);
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
      })
    );

    this.commandsRegistered = true;
  }

  /**
   * Creates a config file in the workspace and reinitializes.
   */
  private async createConfigFile(): Promise<void> {
    const filePath = path.join(this.workspaceRoot, configFiles[0]);
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
      this.notifier.showInformationMessage('config file has been modified.');
    });

    configWatcher.onDidCreate(async () => {
      await this.reinitialize();
      this.commandExecutor.executeCommand('setContext', 'authord.configExists', true);
      this.notifier.showInformationMessage('config file has been created.');
    });

    configWatcher.onDidDelete(async () => {
      await this.reinitialize();
      this.commandExecutor.executeCommand('setContext', 'authord.configExists', false);
      if (process.env.NODE_ENV !== 'test') {
        this.commandExecutor.executeCommand('workbench.action.reloadWindow');
      }
      this.notifier.showInformationMessage('config file has been deleted.');
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
    for (let i = 0; i < configFiles.length; i += 1) {
      const fileName = configFiles[i];
      const filePath = path.join(this.workspaceRoot, fileName);
      try {
        await this.fsModule.access(filePath);
        this.schemaPath = path.join(
          this.context.extensionPath,
          'schemas',
          'authord-config-schema.json'
        );

        if (fileName === configFiles[1]) {
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
