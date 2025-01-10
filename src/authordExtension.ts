import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { configFiles, focusOrShowPreview, setConfigExists } from './utils/helperFunctions';
import { AuthordConfigurationManager } from './configurationManagers/AuthordConfigurationManager';
import { AbstractConfigManager } from './configurationManagers/abstractConfigurationManager';
import { XMLConfigurationManager } from './configurationManagers/XMLConfigurationManager';
import { DocumentationProvider, DocumentationItem } from './services/documentationProvider';
import { TopicsProvider, TopicsItem } from './services/topicsProvider';
import { TopicsDragAndDropController } from './services/topicsDragAndDropController';
import { TocElement, Topic } from './utils/types';

export class Authord {
    private commandsRegistered = false;
    private listenersSubscribed = false;
    private providersRegistered = false;
    private setupConfigWatchers = false;
    private documentationProvider: DocumentationProvider | undefined;
    private topicsProvider: TopicsProvider | undefined;
    private configCode = 0;
    configManager: AbstractConfigManager | undefined;
    currentFileName: string = "";
    currentTopicTitle: string = "";
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
    async initialize(): Promise<void> {
        try {
            this.registerCreateProjectCommand();
            await this.checkConfigFiles();
            if (!this.configCode) {
                vscode.window.showErrorMessage('config file does not exist');
                return;
            }

            if (this.configManager) {
                this.topicsProvider = new TopicsProvider(this.configManager!);
                this.documentationProvider = new DocumentationProvider(
                    this.configManager!,
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
                    this.topicsProvider = new TopicsProvider(this.configManager!);
                    this.documentationProvider = new DocumentationProvider(
                        this.configManager!,
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
     * Registers the DocumentationProvider and TopicsProvider as tree data providers,
     * and creates their corresponding Tree Views.
     */
    private subscribeListeners(): void {
        // Listen for saves of Markdown files
        this.context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(async (editor) => {
                if (editor?.document.languageId === 'markdown' && this.topicsProvider && this.topicsProvider.currentDocId) {
                    let topicTitle = editor.document.lineAt(0).text.trim();
                    if (!topicTitle) {
                        for (let i = 1; i < editor.document.lineCount; i++) {
                            topicTitle = editor.document.lineAt(i).text.trim();
                            if (topicTitle) {
                                break;
                            }
                        }
                    }
                    if (topicTitle.startsWith('#') && !topicTitle.startsWith('##')) {
                        const fileName = path.basename(editor.document.fileName);
                        if (this.currentFileName !== fileName) {
                            // document has changed
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
                        for (let i = 1; i < doc.lineCount; i++) {
                            topicTitle = doc.lineAt(i).text.trim();
                            if (topicTitle) {
                                break;
                            }
                        }
                    }
                    if (!topicTitle) { return; }
                    if (topicTitle.startsWith('# ')) {
                        topicTitle = topicTitle.substring(1).trim();
                    } else {
                        topicTitle = "";
                    }
                    const fileName = path.basename(doc.fileName);
                    if (this.currentTopicTitle === topicTitle && this.currentFileName === fileName) {
                        return;
                    }
                    // 1. Find the corresponding tree item by comparing 'topic' with the saved filename
                    const matchingItem = this.topicsProvider.findTopicItemByFilename(fileName);
                    // 2. Read the title from the first line (or parse frontmatter, if you prefer)
                    if (!matchingItem) {

                        return;
                    }
                    // 3. Update the in-memory model
                    matchingItem.title = topicTitle || `<${fileName}>`;
                    this.topicsProvider!.renameTopic(
                        //todo optimize this pass matchingItem
                        matchingItem.topic,
                        topicTitle || `<${fileName}>`
                    );
                    this.currentTopicTitle = topicTitle;

                }
            })
        );
    }

    private registerProviders(): void {
        if (!this.topicsProvider || !this.documentationProvider) {
            vscode.window.showErrorMessage(
                "topicsProvider or documentationProvider not created"
            );
            return;
        }

        vscode.window.registerTreeDataProvider(
            'documentationsView',
            this.documentationProvider
        );
        vscode.window.registerTreeDataProvider(
            'topicsView',
            this.topicsProvider
        );

        const topicsView = vscode.window.createTreeView('topicsView', {
            treeDataProvider: this.topicsProvider,
            dragAndDropController: new TopicsDragAndDropController(this.topicsProvider)
        });
        const docView = vscode.window.createTreeView('documentationsView', {
            treeDataProvider: this.documentationProvider,
        });


        this.context.subscriptions.push(docView, topicsView);
        this.context.subscriptions.push(
            vscode.window.registerTreeDataProvider('emptyProjectView',
                {
                    getTreeItem: (element: vscode.TreeItem) => element,
                    getChildren: () => [new vscode.TreeItem("No projects found")]
                })
        );
    }

    /**
     * Registers various commands for managing Topics and Documents in the extension.
     */
    private registerCreateProjectCommand(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('extension.createProject', async () => {
                vscode.window.showInformationMessage('Creating a new project...');
                await this.createConfigFile();
            }));
    }

    private registerCommands(): void {
        if (!this.topicsProvider || !this.documentationProvider) {
            vscode.window.showErrorMessage(
                "topicsProvider or documentationProvider not created"
            );
            return;
        }

        const selectInstanceCommand = vscode.commands.registerCommand(
            'authordDocsExtension.selectInstance',
            (docId: string) => {
                const doc = this.configManager!
                    .getDocuments()
                    .find(d => d.id === docId);
                if (!doc) {
                    vscode.window.showErrorMessage(`No document found with id ${docId}`);
                    return;
                }

                const tocElements = doc["toc-elements"];

                this.topicsProvider!.refresh(tocElements, docId);
            }
        );
        //command that calls moveTopic
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
                // Open the markdown file in the first column
                const document = await vscode.workspace.openTextDocument(resourceUri);
                await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

                // Focus the existing preview or open it if it doesn't exist
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
                this.topicsProvider!.setStartPage(item);
            }),
            vscode.commands.registerCommand('extension.deleteTopic', (item: TopicsItem) => {
                this.topicsProvider!.deleteTopic(item);
            }),
            vscode.commands.registerCommand('extension.deleteContextMenuTopic', (item: TopicsItem) => {
                this.topicsProvider!.deleteTopic(item);
            }),
            vscode.commands.registerCommand('extension.renameContextMenuTopic', (item: TopicsItem) => {
                this.topicsProvider!.renameTopicCommand(item);
            }),
            vscode.commands.registerCommand('extension.addDocumentation', () => {
                this.documentationProvider!.addDoc();
            }),
            vscode.commands.registerCommand('extension.reloadConfiguration', () => {
                this.reinitialize();
                this.topicsProvider?.refresh([], null);
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
            vscode.commands.registerCommand('extension.rootTopic', (item: DocumentationItem) => {
                this.topicsProvider!.rootTopic(item);
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


    private async createConfigFile() {
        const filePath = path.join(this.workspaceRoot, configFiles[0]);
        this.configManager = await new AuthordConfigurationManager(filePath).createConfigFile();
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
            setConfigExists(true);
            vscode.window.showInformationMessage('config file has been created.');

        });

        configWatcher.onDidDelete(async () => {
            await this.reinitialize();
            setConfigExists(false);
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
     */
    private async checkConfigFiles(): Promise<void> {
        if (this.configManager && this.configCode) {
            return;
        }
        setConfigExists(false);
        this.configCode = 0;
        for (const fileName of configFiles) {

            const filePath = path.join(this.workspaceRoot, fileName);
            try {
                // The most efficient approach to check file existence is to use fs.promises.access
                await fs.access(filePath);
                const schemaPath = path.join(
                    this.context.extensionPath,
                    'schemas',
                    'authord-config-schema.json'
                );

                if (fileName === configFiles[1]) {
                    // XML config
                    this.configManager = new XMLConfigurationManager(filePath);
                    await this.configManager!.refresh();
                    setConfigExists(true);

                    if (!this.setupConfigWatchers) {
                        this.setupWatchers(fileName);
                        this.setupConfigWatchers = true;
                    }

                    // validateAgainstSchema is also async in updated managers
                    try {
                        await this.configManager!.validateAgainstSchema(schemaPath);
                    } catch (error: any) {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                        vscode.window.showErrorMessage('Failed to initialize extension');
                        vscode.window.showErrorMessage(
                            `Invalid configuration file: ${error.message}`
                        );
                        break;
                    }
                    this.configCode = 1;
                    break;
                } else {
                    // Authord config (default / fallback)
                    this.configManager = new AuthordConfigurationManager(filePath);
                    await this.configManager.refresh();
                    setConfigExists(true);

                    if (!this.setupConfigWatchers) {
                        this.setupWatchers(fileName);
                        this.setupConfigWatchers = true;
                    }

                    try {
                        await this.configManager.validateAgainstSchema(schemaPath);
                    } catch (error: any) {

                        vscode.window.showErrorMessage(
                            `Failed to validate: ${error.message}`
                        );
                        break;
                    }
                    this.configCode = 2;
                    break;
                }
            } catch {
                continue;
            }

        }
    }
}
