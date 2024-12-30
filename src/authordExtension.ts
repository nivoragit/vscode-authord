import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { TocTreeItem } from './utils/types';
import { configFiles, focusOrShowPreview, setConfigExists } from './utils/helperFunctions';
import { AuthordConfigurationManager } from './configurationManagers/AuthordConfigurationManager';
import { AbstractConfigManager, InstanceConfig, TocElement, Topic } from './configurationManagers/abstractConfigurationManager';
import { XMLConfigurationManager } from './configurationManagers/XMLConfigurationManager';
import { DocumentationProvider, DocumentationItem } from './services/documentationProvider';
import { TopicsProvider, TopicsItem } from './services/topicsProvider';

export class Authord {
    private commandsRegistered = false;
    private providersRegistered = false;
    private setupConfigWatchers = false;
    private documentationProvider: DocumentationProvider | undefined;
    private topicsProvider: TopicsProvider | undefined;
    private tocTree: TocTreeItem[] = [];
    private topics: Topic[] = [];
    private instanceId: string | undefined;
    private configCode = 0;
    configManager: AbstractConfigManager | undefined;
    private instances: InstanceConfig[] | undefined;
    
    constructor(
        private context: vscode.ExtensionContext,
        private workspaceRoot: string
    ) {
        if (!workspaceRoot) {
            throw new Error('Workspace root is required to initialize InitializeExtension.');
        }
        // Kick off async initialization
        this.initialize();
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

                const tocTreeItems = doc["toc-elements"].map((e: TocElement) => ({
                    topic: e.topic,
                    title: e.title,
                    sortChildren: e.sortChildren,
                    children: this.parseTocElements(e.children),
                }));

                this.topicsProvider!.refresh(tocTreeItems, docId);
            }
        );

        this.context.subscriptions.push(selectInstanceCommand);
        this.context.subscriptions.push(            
            vscode.commands.registerCommand('authordExtension.openMarkdownFile', async (resourceUri: vscode.Uri) => {
                // Open the markdown file in the first column
                const document = await vscode.workspace.openTextDocument(resourceUri);
                await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

                // Focus the existing preview or open it if it doesn't exist
                await focusOrShowPreview();

            }),

            vscode.commands.registerCommand('extension.addTopic', (item: TopicsItem) => {
                this.topicsProvider!.addTopic(item);
            }),
            vscode.commands.registerCommand('extension.deleteTopic', (item: TopicsItem) => {
                this.topicsProvider!.deleteTopic(item);
            }),
            vscode.commands.registerCommand('extension.addDocumentation', () => {
                this.documentationProvider!.addDoc();
            }),
            vscode.commands.registerCommand('extension.deleteDocumentation', (item: DocumentationItem) => {
                this.documentationProvider!.deleteDoc(item);
            }),
            vscode.commands.registerCommand('extension.rootTopic', (item: DocumentationItem) => {
                this.topicsProvider!.rootTopic(item);
            }),
            vscode.commands.registerCommand('extension.renameTopic', (item: TopicsItem) => {
                this.topicsProvider!.renameTopic(item);
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
     * Helper to link topics (with file paths) into a TOC structure, if needed.
     */
    private linkTopicsToToc(tocTree: TocTreeItem[], topics: Topic[]): void {
        tocTree.forEach(element => {
            if (element.topic) {
                const topic = topics.find(t => t.name === element.topic);
                if (topic) {
                    element.filePath = topic.path;
                }
            }
            if (element.children) {
                this.linkTopicsToToc(element.children, topics);
            }
        });
    }

    /**
     * Sorts TOC elements if `sortChildren` is provided.
     */
    private sortTocElements(tocElements: TocTreeItem[]): void {
        tocElements.forEach(element => {
            if (element.sortChildren && element.children) {
                element.children.sort(
                    (a, b) =>
                        a.title.localeCompare(b.title) *
                        (element.sortChildren === 'ascending' ? 1 : -1)
                );
                this.sortTocElements(element.children);
            }
        });
    }

    /**
     * Recursively transforms `TocElement[]` to `TocTreeItem[]`.
     */
    private parseTocElements(tocElements: TocElement[]): TocTreeItem[] {
        return tocElements.map(element => {
            const children = element.children
                ? this.parseTocElements(element.children)
                : [];
            return {
                title: element.title,
                topic: element.topic,
                sortChildren: element.sortChildren,
                children,
            };
        });
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
                    await this.configManager.refresh();
                    setConfigExists(true);

                    if (!this.setupConfigWatchers) {
                        this.setupWatchers(fileName);
                        this.setupConfigWatchers = true;
                    }

                    // validateAgainstSchema is also async in updated managers
                    try {
                        await this.configManager.validateAgainstSchema(schemaPath);
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
                            `Failed to initialize extension: ${error.message}`
                        );
                        break;
                    }
                    this.configCode = 2;
                    break;
                }
            } catch {
                // File doesn't exist, move on to the next one
                continue;
            }
            
        }

        // No valid config found
        
      
    }
}
