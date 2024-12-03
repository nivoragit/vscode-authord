// import * as vscode from 'vscode';
// import * as path from 'path';
// import * as fs from 'fs';

// export class Author {
//   private topicsPath: string;
//   private instances: any[] = [];
//   private tocTree: any = {};
//   private topics: any[] = [];
//   private documentationProvider: any;
//   private topicsProvider: any;

//   constructor(private context: vscode.ExtensionContext, private workspaceRoot: string) {
//     if (!workspaceRoot) {
//       throw new Error('Workspace root is required to initialize Author.');
//     }
//     this.topicsPath = path.join(workspaceRoot, 'topics');
//   }

//   /**
//    * Register the necessary providers and commands.
//    */
//   public register(): void {
//     // Example: Register commands
//     this.context.subscriptions.push(
//       vscode.commands.registerCommand('author.refreshTopics', () =>
//         Author.refreshTopics(this.tocTree, this.topicsPath, this.topicsProvider)
//       )
//     );

//     this.context.subscriptions.push(
//       vscode.commands.registerCommand('author.refreshConfigurations', () =>
//         Author.refreshConfigurations(path.join(this.workspaceRoot!, 'authord.config.json'), this.workspaceRoot!, this.documentationProvider, this.topicsProvider)
//       )
//     );

//     // Example: Register other providers
//     // Register your providers like topicsProvider, documentationProvider, etc.
//   }

//   /**
//    * Setup watchers for the topics directory and configuration files.
//    */
//   public setupWatchers(): void {
//     const topicsWatcher = vscode.workspace.createFileSystemWatcher(
//       new vscode.RelativePattern(this.topicsPath, '**/*.md')
//     );

//     topicsWatcher.onDidCreate(() =>
//       Author.refreshTopics(this.tocTree, this.topicsPath, this.topicsProvider)
//     );
//     topicsWatcher.onDidChange(() =>
//       Author.refreshTopics(this.tocTree, this.topicsPath, this.topicsProvider)
//     );
//     topicsWatcher.onDidDelete(() =>
//       Author.refreshTopics(this.tocTree, this.topicsPath, this.topicsProvider)
//     );

//     const configWatcher = vscode.workspace.createFileSystemWatcher(
//       new vscode.RelativePattern(this.workspaceRoot!, 'authord.config.json')
//     );

//     configWatcher.onDidChange(() =>
//       Author.refreshConfigurations(
//         path.join(this.workspaceRoot!, 'authord.config.json'),
//         this.workspaceRoot!,
//         this.documentationProvider,
//         this.topicsProvider
//       )
//     );

//     this.context.subscriptions.push(topicsWatcher);
//     this.context.subscriptions.push(configWatcher);
//   }

//   /**
//    * Link topics to table-of-contents elements.
//    */
//   public static linkTopicsToToc(tocTree: any, topics: any[]): void {
//     for (const tocElement of tocTree.elements) {
//       const topic = topics.find((t) => t.id === tocElement.topicId);
//       if (topic) {
//         tocElement.content = topic.content;
//       }
//     }
//   }

//   /**
//    * Sort table-of-contents elements based on the specified criteria.
//    */
//   public static sortTocElements(tocTree: any): void {
//     if (!tocTree || !tocTree.elements) return;

//     tocTree.elements.sort((a: any, b: any) => {
//       if (a.sortOrder === 'ascending') {
//         return a.title.localeCompare(b.title);
//       } else if (a.sortOrder === 'descending') {
//         return b.title.localeCompare(a.title);
//       }
//       return 0;
//     });
//   }

//   /**
//    * Refresh topics by reloading data from the topics directory.
//    */
//   public static refreshTopics(tocTree: any, topicsPath: string, topicsProvider: any): void {
//     if (!fs.existsSync(topicsPath)) {
//       vscode.window.showErrorMessage('Topics directory does not exist.');
//       return;
//     }

//     const topicFiles = fs.readdirSync(topicsPath).filter((file) => file.endsWith('.md'));
//     const topics = topicFiles.map((file) => {
//       const content = fs.readFileSync(path.join(topicsPath, file), 'utf-8');
//       return { id: path.basename(file, '.md'), content };
//     });

//     if (topicsProvider) {
//       topicsProvider.setTopics(topics);
//     }

//     Author.linkTopicsToToc(tocTree, topics);
//     Author.sortTocElements(tocTree);

//     vscode.window.showInformationMessage('Topics refreshed successfully.');
//   }

//   /**
//    * Refresh configurations from the configuration file.
//    */
//   public static refreshConfigurations(
//     configPath: string,
//     workspaceRoot: string,
//     documentationProvider: any,
//     topicsProvider: any
//   ): void {
//     if (!fs.existsSync(configPath)) {
//       vscode.window.showErrorMessage('Configuration file does not exist.');
//       return;
//     }

//     const configContent = fs.readFileSync(configPath, 'utf-8');
//     try {
//       const config = JSON.parse(configContent);
//       if (documentationProvider) {
//         documentationProvider.setConfig(config);
//       }
//       if (topicsProvider) {
//         topicsProvider.setConfig(config);
//       }

//       vscode.window.showInformationMessage('Configurations refreshed successfully.');
//     } catch (error) {
//       vscode.window.showErrorMessage('Failed to parse configuration file.');
//     }
//   }
// }
