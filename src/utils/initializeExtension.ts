
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import Ajv from 'ajv';
import { DocumentationItem, DocumentationProvider } from "../views/documentationProvider";
import { TopicsItem, TopicsProvider } from "../views/topicsProvider";
import { Config, TocTreeItem } from './types';
import { configFiles, setConfigExists } from './helperFunctions';
import { AuthordConfigurationManager, AuthordConfig } from '../config/AuthordConfigurationManager';
import { AbstractConfigManager, InstanceConfig, TocElement, Topic } from '../config/abstractConfigManager';
import { XMLConfigurationManager } from '../config/XMLConfigurationManager';


export class InitializeExtension {
    private commandsRegistered: boolean = false;
    private providersRegistered: boolean = false;
    private setupConfigWatchers: boolean = false;
    private documentationProvider: DocumentationProvider | undefined;
    private topicsProvider: TopicsProvider | undefined;
    private tocTree: TocTreeItem[] = [];
    private topics: Topic[] = [];
    private instanceId: string | undefined;
    private configCode: number = 0;
    private configManager: AbstractConfigManager | undefined;
    private instances: InstanceConfig[] | undefined;



    constructor(private context: vscode.ExtensionContext, private workspaceRoot: string) {
        if (!workspaceRoot) {
            throw new Error('Workspace root is required to initialize InitializeExtension.');
        }
        // this.configPath = path.join(this.workspaceRoot, configFiles[0]);
        this.initialize();

    }

    async initialize(): Promise<void> {
        try {
            this.configCode = await this.checkConfigFiles();
            if (!this.configCode) {
                vscode.window.showErrorMessage('config file does not exist');

                return;
            } else if (this.instances) {               
                this.topicsProvider = new TopicsProvider(this.configManager!);
                this.documentationProvider = new DocumentationProvider(this.configManager!, this.topicsProvider);
                this.registerProviders();
                this.providersRegistered = true;

            }
            this.registerCommands();
            this.commandsRegistered = true;

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to initialize extension: ${error.message}`);
            vscode.commands.executeCommand('setContext', 'authord.configExists', false); // witout updating ConfigExists variable
        }

    }

    async reinitialize(): Promise<void> {
        try {
            this.configCode = await this.checkConfigFiles();
            if (!this.configCode) {
                vscode.window.showErrorMessage('config file does not exist');
            } else if (this.instances) {
                // this.dispose();
                // this.registerProviders();
                if (!this.documentationProvider || !this.topicsProvider) {
                    this.topicsProvider = new TopicsProvider(this.configManager!);
                    this.documentationProvider = new DocumentationProvider(this.configManager!,this.topicsProvider);
                    
                }
                if (!this.providersRegistered) {
                    this.registerProviders();
                    this.providersRegistered = true;
                }
                if (!this.commandsRegistered) {
                    this.registerCommands();
                    this.commandsRegistered = true;
                }
                // refresh when file update from outside
                // if (!this.instanceId) {
                //     this.tocTree = [];
                //     this.topicsProvider?.refresh(this.tocTree,"");
                //     this.documentationProvider.refresh();
                //     // when doc tree need to refresh toc tree
                //     // this.tocTree = this.instances.flatMap(instance =>
                //     //     instance.id === this.instanceId ? this.parseTocElements(instance['toc-elements']) : []);
                //     // this.topicsProvider?.refresh(this.tocTree,this.instanceId);
                // }
                this.documentationProvider.refresh();
                

            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to reinitialize extension: ${error.message}`);
            vscode.commands.executeCommand('setContext', 'authord.configExists', false); // witout updating ConfigExists variable

        }
    }
    // Extension Deactivation, External Cleanup
    // dispose(): void {
    //     this.disposables.forEach(disposable => disposable.dispose());
    //     this.disposables = [];
    // }





    private registerProviders(): void {
        if (!this.topicsProvider || !this.documentationProvider) {
            vscode.window.showErrorMessage("topicsProvider or documentationProvider not created");
            return;
        }
        vscode.window.registerTreeDataProvider('documentationsView', this.documentationProvider);
        vscode.window.registerTreeDataProvider('topicsView', this.topicsProvider);


        // Create and register tree views
        const topicsView = vscode.window.createTreeView('topicsView', {
            treeDataProvider: this.topicsProvider,
        });
        const docsView = vscode.window.createTreeView('documentationsView', {
            treeDataProvider: this.documentationProvider,
        });

        // Add the tree views to context subscriptions for automatic disposal
        this.context.subscriptions.push(topicsView, docsView);

    }



    private registerCommands(): void {
        if (!this.topicsProvider || !this.documentationProvider) {
            vscode.window.showErrorMessage("topicsProvider or documentationProvider not created");
            return;

        }
        // Register commands and push them to disposables for later cleanup
        // const selectInstanceCommand = vscode.commands.registerCommand('authordDocsExtension.selectInstance', (instanceId) => {
        //     this.instanceId = instanceId;
        //     this.tocTree = this.instances!.flatMap(instance =>
        //         instance.id === instanceId ? this.parseTocElements(instance['toc-elements']) : []);
        //     this.linkTopicsToToc(this.tocTree, this.topics);
        //     this.sortTocElements(this.tocTree);
        //     this.topicsProvider!.refresh(this.tocTree, instanceId);
        // });
        const selectInstanceCommand = vscode.commands.registerCommand('authordDocsExtension.selectInstance', (docId: string) => {
            const doc = this.configManager!.getDocuments().find(d => d.id === docId);
            if (!doc) {
                vscode.window.showErrorMessage(`No document found with id ${docId}`);
                return;
            }

            // Transform doc["toc-elements"] (TocElement[]) into TocTreeItem[]
            const tocTreeItems = doc["toc-elements"].map((e: TocElement) => {
                return {
                    topic: e.topic,
                    title: e.title,
                    sortChildren: e.sortChildren,
                    children: this.parseTocElements(e.children)
                };
            });

            this.topicsProvider!.refresh(tocTreeItems, docId);
        });

        this.context.subscriptions.push(selectInstanceCommand);
        this.context.subscriptions.push(
            // Topics Commands
            vscode.commands.registerCommand('extension.addTopic', (item: TopicsItem) => {
                this.topicsProvider!.addTopic(item);
            }),
            vscode.commands.registerCommand('extension.deleteTopic', (item: TopicsItem) => {
                this.topicsProvider!.deleteTopic(item);
            }),
            // Documentation Commands
            vscode.commands.registerCommand('extension.addDocumentation', () => {
                this.documentationProvider!.addDoc();
            }),
            vscode.commands.registerCommand('extension.deleteDocumentation', (item: DocumentationItem) => {
                this.documentationProvider!.deleteDoc(item);
            }),
            vscode.commands.registerCommand('extension.newTopic', (item: DocumentationItem) => {
                this.documentationProvider!.newTopic(item);
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

    private sortTocElements(tocElements: TocTreeItem[]): void {
        tocElements.forEach(element => {
            if (element.sortChildren && element.children) {
                element.children.sort((a, b) => a.title.localeCompare(b.title) * (element.sortChildren === 'ascending' ? 1 : -1));
                this.sortTocElements(element.children);
            }
        });
    }

    private parseTocElements(tocElements: TocElement[]): TocTreeItem[] {
        return tocElements.map(element => {
            const children = element.children ? this.parseTocElements(element.children) : [];
            return {
                title: element.title,
                topic: element.topic,
                sortChildren: element.sortChildren,
                children,
            };
        });
    }
    setupWatchers(fileName: string): void {
        // Create a file system watcher for the configuration file
        // todo add watcher for .tree files??
        const configWatcher = vscode.workspace.createFileSystemWatcher(

            new vscode.RelativePattern(this.workspaceRoot, fileName)
        );

        // Handle file changes
        configWatcher.onDidChange(async () => {
            await this.reinitialize();
            vscode.window.showInformationMessage('config file has been modified.');

        });

        // Handle file creation
        configWatcher.onDidCreate(async () => {
            await this.reinitialize();
            vscode.window.showInformationMessage('config file has been created.');
        });

        // Handle file deletion
        configWatcher.onDidDelete(async () => {
            await this.reinitialize();
            vscode.window.showInformationMessage('config file has been deleted.');
        });

        // Add watchers to context subscriptions
        this.context.subscriptions.push(configWatcher);
    }
    // private validateConfig(config: Config): boolean {

    //     const ajv = new Ajv();
    //     const schemaPath = path.join(this.context.extensionPath, 'schemas', 'authord-config-schema.json');
    //     const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    //     const validate = ajv.compile(schema);

    //     if (!validate(config)) {
    //         const errors = validate.errors?.map(e => `${e.instancePath} ${e.message}`).join('\n');
    //         vscode.window.showErrorMessage(`Invalid config according to schema:\n${errors}`);
    //         vscode.commands.executeCommand('setContext', 'authord.configExists', false); // witout updating ConfigExists variable
    //         return false;
    //         // throw new Error();
    //     }
    //     return true;
    // }

    private async checkConfigFiles() {
        // this function get call several times
        for (const fileName of configFiles) {
            const filePath = path.join(this.workspaceRoot, fileName);
            if (fs.existsSync(filePath)) {
                const schemaPath = path.join(this.context.extensionPath, 'schemas', 'authord-config-schema.json');

                // check if wSide config which is at 2nd position
                if (fileName === configFiles[1]) {

                    this.configManager = new XMLConfigurationManager(filePath);


                    try {
                        (this.configManager as XMLConfigurationManager).validateAgainstSchema(schemaPath);
                    }
                    catch (error: any) {
                        setConfigExists(false);
                        vscode.window.showErrorMessage(`Failed to initialize extension: ${error.message}`);
                        return 0;
                    }
                    this.instances = this.configManager!.loadInstances();
                    setConfigExists(true);
                    if (!this.setupConfigWatchers) {

                        this.setupWatchers(fileName); // for xml file
                        this.setupConfigWatchers = true;
                    }
                    return 1;
                }
                this.configManager = new AuthordConfigurationManager(filePath);
                try {
                    (this.configManager as AuthordConfigurationManager).validateAgainstSchema(schemaPath);
                }
                catch (error: any) {
                    setConfigExists(false);
                    vscode.window.showErrorMessage(`Failed to initialize extension: ${error.message}`);
                    // this.configPath ="";
                    return 0;
                }
                this.instances = this.configManager.loadInstances();
                setConfigExists(true);
                if (!this.setupConfigWatchers) {
                    this.setupWatchers(fileName); // authord config
                    this.setupConfigWatchers = true;
                }
                return 2;
            }
        }
        // this.configPath ="";
        setConfigExists(false);
        return 0;
    }


}