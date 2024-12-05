import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DocumentationProvider } from "../views/documentationProvider";
import { TopicsProvider } from "../views/topicsProvider";
import { Config, TocElement, TocTreeItem, Topic } from './types';
import { checkConfigFiles, configFiles, setConfigExists } from './helperFunctions';

export class InitializeExtension {
    private topicsPath: string = "";
    private configPath: string;
    private documentationProvider: DocumentationProvider | undefined;
    private instances: any[] = [];
    private tocTree: TocTreeItem[] = [];
    private topics: Topic[] = [];
    private topicsProvider: TopicsProvider = new TopicsProvider();
    private disposables: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext, private workspaceRoot: string) {
        if (!workspaceRoot) {
            throw new Error('Workspace root is required to initialize InitializeExtension.');
        }
        this.configPath = path.join(this.workspaceRoot, configFiles[0]);
        
    }

    initialize(): void{
        if (!(checkConfigFiles(this.workspaceRoot))) {
            vscode.window.showErrorMessage('config file does not exist'); 
            return;
        }
        this.config();
        this.registerProviders();
        this.registerCommands();
        // Setup watchers
        this.setupWatchers();
    }

    reinitialize(): void {
        try{
            // Clean up existing disposables
            this.dispose();
            if (!(checkConfigFiles(this.workspaceRoot))) {
                vscode.window.showErrorMessage('config file does not exist'); 
                return;
            }
            
            // Re-run the initialization
            this.config();
            this.registerProviders();
            this.registerCommands();
            setConfigExists(true);
        }catch (error: any) {
            vscode.window.showErrorMessage(`Failed to reload configuration: ${error.message}`);
            vscode.commands.executeCommand('setContext', 'authord.configExists', false);
        }
    }
    // Extension Deactivation, External Cleanup
    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
    }
    private config(): void{
        
        const config: Config = this.loadConfigurations();
        const topicsDir = config['topics']['dir'];
        this.topicsPath = path.join(this.workspaceRoot, topicsDir);
        this.topics = this.loadTopics(this.topicsPath);
        this.instances = config.instances;
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
    private loadConfigurations(): Config{
        const configContent = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(configContent);
    }

    private registerProviders(): void {
        this.documentationProvider = new DocumentationProvider(this.instances);
        this.context.subscriptions.push(
            vscode.window.registerTreeDataProvider('documentationsView', this.documentationProvider),
            vscode.window.registerTreeDataProvider('topicsView', this.topicsProvider)
        );
    }

    private registerCommands(): void {
        // Register commands and push them to disposables for later cleanup
        const selectInstanceCommand = vscode.commands.registerCommand('authordDocsExtension.selectInstance', (instanceId) => {

            this.tocTree = this.instances.flatMap(instance =>
                instance.id === instanceId ? this.parseTocElements(instance['toc-elements']) : []);
            this.linkTopicsToToc(this.tocTree, this.topics);
            this.sortTocElements(this.tocTree);
            this.topicsProvider.refresh(this.tocTree);
        });
        this.disposables.push(selectInstanceCommand);
        this.context.subscriptions.push(selectInstanceCommand);
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

        // Watch for changes in configuration
        const configWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.workspaceRoot, 'authord.config.json'));
        configWatcher.onDidChange(() => this.reinitialize());

        // Add watchers to context subscriptions
        this.context.subscriptions.push(configWatcher);
    }
}

