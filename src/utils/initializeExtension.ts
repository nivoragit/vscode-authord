
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import Ajv from 'ajv';
import { DocumentationItem, DocumentationProvider } from "../views/documentationProvider";
import { TopicsItem, TopicsProvider } from "../views/topicsProvider";
import { Config, InstanceConfig, TocElement, TocTreeItem, Topic } from './types';
import { configFiles, generateJson, setConfigExists } from './helperFunctions';
import { writeFile } from './fileUtils';
import { AuthordConfigurationManager } from '../config/AuthordConfigurationManager';
import { AbstractConfigManager } from '../config/abstractConfigManager';

export class InitializeExtension {
    private topicsPath: string = "";
    private commandsRegistered: boolean = false;
    private providersRegistered: boolean = false;
    private configPath: string;
    private documentationProvider: DocumentationProvider | undefined;
    private topicsProvider: TopicsProvider | undefined;
    private configfile: Config | undefined;

    private instances: InstanceConfig[] | undefined;
    private tocTree: TocTreeItem[] = [];
    private topics: Topic[] = [];
    private instanceId: string | undefined;
    private configCode: number = 0;



    constructor(private context: vscode.ExtensionContext, private workspaceRoot: string) {
        if (!workspaceRoot) {
            throw new Error('Workspace root is required to initialize InitializeExtension.');
        }
        this.configPath = path.join(this.workspaceRoot, configFiles[0]);
        this.initialize();

    }

    async initialize(): Promise<void> {
        try {
            this.configCode = await this.checkConfigFiles();
            if (!this.configCode) {
                vscode.window.showErrorMessage('config file does not exist');
                this.setupWatchers();
                return;
            } else if (this.config()) {
                this.registerProviders();
                this.providersRegistered = true;

            }
            this.registerCommands();
            this.commandsRegistered = true;

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to initialize extension: ${error.message}`);
            vscode.commands.executeCommand('setContext', 'authord.configExists', false); // witout updating ConfigExists variable
        }
        // Setup watchers
        this.setupWatchers();
    }

    async reinitialize(): Promise<void> {
        try {
            this.configCode = await this.checkConfigFiles();
            if (!this.configCode) {
                vscode.window.showErrorMessage('config file does not exist');
            } else if (this.config()) {
                // this.dispose();
                // this.registerProviders();
                if (!this.providersRegistered) {
                    this.registerProviders();
                    this.providersRegistered = true;
                }
                if (!this.commandsRegistered) {
                    this.registerCommands();
                    this.commandsRegistered = true;
                }
                if (this.instanceId) {
                    // when doc tree need to refresh toc tree
                    this.tocTree = this.instances!.flatMap(instance =>
                        instance.id === this.instanceId ? this.parseTocElements(instance['toc-elements']) : []);
                    this.topicsProvider?.refresh(this.tocTree);
                }

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
    private config(): boolean {
        try {
            if (!this.configfile) { return false; }
            const topicsDir = this.configfile['topics']['dir'];
            this.topicsPath = path.join(this.workspaceRoot, topicsDir);
            this.topics = this.loadTopics(this.topicsPath);
            this.instances = this.configfile.instances;
            if (!this.documentationProvider || !this.topicsProvider) {
                let configManager = undefined;
                if (this.configCode === 2) {
                    configManager = new AuthordConfigurationManager(this.configPath);
                }
                // else if(this.configCode === 2){
                // todo xml config
                // }else{

                // }

                if (configManager) {
                    this.documentationProvider = new DocumentationProvider(configManager as AbstractConfigManager);
                    this.topicsProvider = new TopicsProvider(this.tocTree, configManager as AbstractConfigManager);
                }else{
                    return false;
                }
            }
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to config extension: ${error}`);
            return false;
        }
    }

    private loadTopics(topicsPath: string): Topic[] {
        try {
            const markdownFiles: Topic[] = [];

            const traverseDirectory = (dirPath: string) => {
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        traverseDirectory(fullPath); // Recursively explore subdirectories
                    } else if (entry.isFile() && entry.name.endsWith('.md')) {
                        markdownFiles.push({
                            name: path.basename(entry.name),
                            path: fullPath,
                        });
                    }
                }
            };
            traverseDirectory(topicsPath);
            return markdownFiles;
        } catch (error: any) {
            console.error(`Error loading topics: ${error.message}`);
            return [];
        }
    }
    private loadConfigurations(): Config {
        const configContent = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(configContent);
    }

    private registerProviders(): void {
        if (!this.topicsProvider || !this.documentationProvider) {
            vscode.window.showErrorMessage("topicsProvider or documentationProvider not created");
            return;
        }
        const treeProviderDisposable = vscode.window.registerTreeDataProvider('documentationsView', this.documentationProvider);
        const topicProviderDisposable = vscode.window.registerTreeDataProvider('topicsView', this.topicsProvider);

        // this.disposables.push(treeProviderDisposable);
        // this.disposables.push(topicProviderDisposable);
    }

    private registerCommands(): void {
        if (!this.topicsProvider || !this.documentationProvider) {
            vscode.window.showErrorMessage("topicsProvider or documentationProvider not created");
            return;

        }
        // Register commands and push them to disposables for later cleanup
        const selectInstanceCommand = vscode.commands.registerCommand('authordDocsExtension.selectInstance', (instanceId) => {
            this.instanceId = instanceId;
            this.tocTree = this.instances!.flatMap(instance =>
                instance.id === instanceId ? this.parseTocElements(instance['toc-elements']) : []);
            this.linkTopicsToToc(this.tocTree, this.topics);
            this.sortTocElements(this.tocTree);
            this.topicsProvider!.refresh(this.tocTree, instanceId);
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
                id: element.id,
                title: element['toc-title'],
                topic: element.topic,
                sortChildren: element['sort-children'],
                children,
            };
        });
    }
    private setupWatchers(): void {
        // Create a file system watcher for the configuration file
        const configWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspaceRoot, 'authord.config.json')
        );

        // Handle file changes
        configWatcher.onDidChange(async () => {
            await this.reinitialize();
            vscode.window.showInformationMessage('authord.config.json has been modified.');

        });

        // Handle file creation
        configWatcher.onDidCreate(async () => {
            await this.reinitialize();
            vscode.window.showInformationMessage('authord.config.json has been created.');
        });

        // Handle file deletion
        configWatcher.onDidDelete(async () => {
            await this.reinitialize();
            vscode.window.showInformationMessage('authord.config.json has been deleted.');
        });

        // Add watchers to context subscriptions
        this.context.subscriptions.push(configWatcher);
    }
    private validateConfig(config: Config): boolean {

        const ajv = new Ajv();
        const schemaPath = path.join(this.context.extensionPath, 'schemas', 'authord-config-schema.json');
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
        const validate = ajv.compile(schema);

        if (!validate(config)) {
            const errors = validate.errors?.map(e => `${e.instancePath} ${e.message}`).join('\n');
            vscode.window.showErrorMessage(`Invalid config according to schema:\n${errors}`);
            vscode.commands.executeCommand('setContext', 'authord.configExists', false); // witout updating ConfigExists variable
            return false;
            // throw new Error();
        }
        return true;
    }
    private async checkConfigFiles() {

        for (const fileName of configFiles) {
            const filePath = path.join(this.workspaceRoot, fileName);
            if (fs.existsSync(filePath)) {
                // check if wSide config which is at 2nd position
                if (fileName === configFiles[1]) {

                    // this means no author.config
                    return 1;
                    // try {
                    //     const convertedConfig = await generateJson(filePath);
                    //     await writeFile(path.join(this.workspaceRoot, configFiles[0]), JSON.stringify(convertedConfig));
                    // } catch (error: any) {
                    //     vscode.window.showErrorMessage(`Error reading authord.json: ${error.message}`);

                    //     return setConfigExists(false);
                    // }
                }
                this.configfile = this.loadConfigurations();
                setConfigExists(this.validateConfig(this.configfile));
                return 2;
            }
        }
        setConfigExists(false);
        return 0;
    }


}