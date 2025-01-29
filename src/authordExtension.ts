/*
    Presentation Layer
    ├─ Command Handlers
    └─ UI Components
*/
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { configFiles, focusOrShowPreview } from './utils/helperFunctions';
import DocumentationProvider from './services/documentationProvider';
import TopicsProvider from './services/topicsProvider';
import TopicsDragAndDropController from './services/topicsDragAndDropController';
import DocumentationItem from './services/documentationItem';
import TopicsItem from './services/topicsItem';
import TopicsService from './services/TopicsService';
import DocumentationService from './services/DocumentationService';
import AbstractConfigManager from './managers/AbstractConfigManager';
import AuthordConfigurationManager from './managers/AuthordConfigurationManager';
import XMLConfigurationManager from './managers/XMLConfigurationManager';

// Using a default export to comply with `import/prefer-default-export`
export default class Authord {
  private commandsRegistered = false;

  private listenersSubscribed = false;

  private providersRegistered = false;

  private setupConfigWatchers = false;

  private documentationProvider: DocumentationProvider | undefined;

  private topicsProvider: TopicsProvider | undefined;

  private configCode = 0;

  configManager: AbstractConfigManager | undefined;

  currentFileName = '';

  currentTopicTitle = '';

  constructor(
    private context: vscode.ExtensionContext,
    private workspaceRoot: string
  ) {
    if (!workspaceRoot) {
      throw new Error('Workspace root is required to initialize InitializeExtension.');
    }
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
        vscode.window.showErrorMessage('config file does not exist');
        return;
      }

      if (this.configManager) {
        this.topicsProvider = new TopicsProvider(new TopicsService(this.configManager));
        this.documentationProvider = new DocumentationProvider(
          new DocumentationService(this.configManager),
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
      vscode.window.showErrorMessage(`Failed to initialize extension: ${error.message}`);
      vscode.commands.executeCommand('setContext', 'authord.configExists', false);
    }
  }

  /**
   * Reinitializes the extension if config changes or is recreated.
   */
  public async reinitialize(): Promise<void> {
    try {
      await this.checkConfigFiles();

      if (!this.configCode) {
        vscode.window.showErrorMessage('config file does not exist');
      } else {
        if (!this.documentationProvider || !this.topicsProvider) {
          this.topicsProvider = new TopicsProvider(new TopicsService(this.configManager!));
          this.documentationProvider = new DocumentationProvider(
            new DocumentationService(this.configManager!),
            this.topicsProvider
          );
        }

        if (this.configManager) {
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

          this.configManager.refresh();
        }

        this.documentationProvider?.refresh();
        vscode.window.showInformationMessage('extension reinitialized');
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to reinitialize extension: ${error.message}`);
      vscode.commands.executeCommand('setContext', 'authord.configExists', false);
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
          vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
      }),

      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (
          editor?.document.languageId === 'markdown' &&
          this.topicsProvider &&
          this.topicsProvider.currentDocId
        ) {
          // Set this.currentFileName and this.currentTopicTitle for the first time
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
              // Document has changed
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

          // 1. Find the corresponding tree item by comparing 'topic' with the saved filename
          const matchingItem = this.topicsProvider.findTopicItemByFilename(fileName);

          // 2. Read the title from the first line or parse frontmatter
          if (!matchingItem) {
            return;
          }

          // 3. Update the in-memory model
          matchingItem.title = topicTitle || `<${fileName}>`;
          this.topicsProvider.renameTopic(
            matchingItem.topic,
            topicTitle || `<${fileName}>`
          );
          this.currentTopicTitle = topicTitle;
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
      vscode.window.showErrorMessage('topicsProvider or documentationProvider not created');
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
      vscode.commands.registerCommand('extension.createProject', async () => {
        vscode.window.showInformationMessage('Creating a new project...');
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
      vscode.window.showErrorMessage('topicsProvider or documentationProvider not created');
      return;
    }

    const selectInstanceCommand = vscode.commands.registerCommand(
      'authordDocsExtension.selectInstance',
      (docId: string) => {
        const doc = this.configManager!.getDocuments().find((d) => d.id === docId);
        if (!doc) {
          vscode.window.showErrorMessage(`No document found with id ${docId}`);
          return;
        }
        const tocElements = doc['toc-elements'];
        this.topicsProvider!.refresh(tocElements, docId);
      }
    );

    const moveTopicCommand = vscode.commands.registerCommand(
      'extension.moveTopic',
      async (sourceTopicId: string, targetTopicId: string) => {
        await this.topicsProvider!.moveTopic(sourceTopicId, targetTopicId);
      }
    );

    this.context.subscriptions.push(selectInstanceCommand);
    this.context.subscriptions.push(moveTopicCommand);

    this.context.subscriptions.push(
      vscode.commands.registerCommand('authordExtension.openMarkdownFile', async (resourceUri: vscode.Uri) => {
        const document = await vscode.workspace.openTextDocument(resourceUri);
        await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        await focusOrShowPreview();
      }),

      vscode.commands.registerCommand('extension.addChildTopic', (item: TopicsItem) => {
        this.topicsProvider!.addChildTopic(item);
      }),

      vscode.commands.registerCommand('extension.addContextMenuChildTopic', (item: TopicsItem) => {
        this.topicsProvider!.addChildTopic(item);
      }),

      vscode.commands.registerCommand('extension.addContextMenuTopic', (item: TopicsItem) => {
        this.topicsProvider!.addSiblingTopic(item);
      }),

      vscode.commands.registerCommand('extension.ContextMenuSetasStartPage', (item: TopicsItem) => {
        this.topicsProvider!.setAsStartPage(item.topic);
      }),

      vscode.commands.registerCommand('extension.deleteTopic', (item: TopicsItem) => {
        this.topicsProvider!.deleteTopic(item);
      }),

      vscode.commands.registerCommand('extension.deleteContextMenuTopic', (item: TopicsItem) => {
        this.topicsProvider!.deleteTopic(item);
      }),

      vscode.commands.registerCommand('extension.renameContextMenuTopic', (item: TopicsItem) => {
        this.topicsProvider!.editTitle(item);
      }),

      vscode.commands.registerCommand('extension.addDocumentation', () => {
        this.documentationProvider!.addDoc();
      }),

      vscode.commands.registerCommand('extension.reloadConfiguration', () => {
        this.reinitialize();
        this.topicsProvider?.refresh([]);
      }),

      vscode.commands.registerCommand('extension.addContextMenuDocumentation', () => {
        this.documentationProvider!.addDoc();
      }),

      vscode.commands.registerCommand('extension.deleteDocumentation', (item: DocumentationItem) => {
        this.documentationProvider!.deleteDoc(item);
      }),

      vscode.commands.registerCommand('extension.deleteContextMenuDocumentation', (item: DocumentationItem) => {
        this.documentationProvider!.deleteDoc(item);
      }),

      vscode.commands.registerCommand('extension.rootTopic', () => {
        this.topicsProvider!.addRootTopic();
      }),

      vscode.commands.registerCommand('extension.renameContextMenuDoc', (item: DocumentationItem) => {
        this.documentationProvider!.renameDoc(item);
      }),

      vscode.commands.registerCommand('extension.renameDoc', (item: DocumentationItem) => {
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
    this.configManager = await new AuthordConfigurationManager(filePath).createConfigFile();
    await this.configManager.refresh();
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
      vscode.window.showInformationMessage('config file has been modified.');
    });

    configWatcher.onDidCreate(async () => {
      await this.reinitialize();
      vscode.commands.executeCommand('setContext', 'authord.configExists', true);
      vscode.window.showInformationMessage('config file has been created.');
    });

    configWatcher.onDidDelete(async () => {
      await this.reinitialize();
      vscode.commands.executeCommand('setContext', 'authord.configExists', false);
      vscode.commands.executeCommand('workbench.action.reloadWindow');
      vscode.window.showInformationMessage('config file has been deleted.');
    });

    this.context.subscriptions.push(configWatcher);
  }

  /**
   * Asynchronously checks for the presence of known config files (defined in configFiles array).
   * Returns:
   *  - 0 if no valid config file is found
   *  - 1 if an XML config file is found (configFiles[1])
   *  - 2 if an Authord config file is found (configFiles[0])
   * 
   * The most efficient approach here is using fs.promises.access for file existence checks.
   */
  private async checkConfigFiles(): Promise<void> {
    if (this.configManager && this.configCode) {
      return;
    }

    vscode.commands.executeCommand('setContext', 'authord.configExists', false);
    this.configCode = 0;

    let foundConfig = false;
    for (let i = 0; i < configFiles.length; i += 1) {
      const fileName = configFiles[i];
      const filePath = path.join(this.workspaceRoot, fileName);
      try {
        await fs.access(filePath);
        const schemaPath = path.join(
          this.context.extensionPath,
          'schemas',
          'authord-config-schema.json'
        );

        if (fileName === configFiles[1]) {
          // XML config
          this.configManager = new XMLConfigurationManager(filePath);
          await this.configManager.refresh();
          vscode.commands.executeCommand('setContext', 'authord.configExists', true);

          if (!this.setupConfigWatchers) {
            this.setupWatchers(fileName);
            this.setupConfigWatchers = true;
          }

          // Validate against schema
          try {
            await this.configManager.validateAgainstSchema(schemaPath);
          } catch (error: any) {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
            vscode.window.showErrorMessage('Failed to initialize extension');
            vscode.window.showErrorMessage(`Invalid configuration file: ${error.message}`);
            break;
          }

          this.configCode = 1;
          foundConfig = true;
        } else {
          // Authord config (default / fallback)
          this.configManager = new AuthordConfigurationManager(filePath);
          await this.configManager.refresh();
          vscode.commands.executeCommand('setContext', 'authord.configExists', true);

          if (!this.setupConfigWatchers) {
            this.setupWatchers(fileName);
            this.setupConfigWatchers = true;
          }

          try {
            await this.configManager.validateAgainstSchema(schemaPath);
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to validate: ${error.message}`);
            break;
          }

          this.configCode = 2;
          foundConfig = true;
        }

        if (foundConfig) {
          break;
        }
      } catch {
        // Instead of `continue`, we simply do nothing here and move to the next iteration.
      }
    }
  }
}
