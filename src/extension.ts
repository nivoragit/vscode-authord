import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { SidebarProvider } from './views/sidebarView';
import { MarkdownFileProvider } from './views/markdownFileProvider';
import { AuthordViewProvider } from './views/authordViewProvider';
import { focusExistingPreview, linkTopicsToToc, loadTopics, parseTocElements, sortTocElements} from './utils/helperFunctions';
import { initializeConfig, loadConfig, refreshConfiguration } from './commands/config';
import { DocumentationProvider } from './views/documentationProvider';
import { refreshTopics, initializeTopics } from './views/topics';
import { TopicsProvider } from './views/topicsProvider';
import path from 'path';
import { Config, Topic } from './utils/types';

export function activate(context: vscode.ExtensionContext) {
  // Get the workspace root
  if (!vscode.workspace.workspaceFolders) { return; }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

  // Register the Authord Documentation View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AuthordViewProvider.viewType, // ID from package.json
      new AuthordViewProvider(context, workspaceRoot)
    )
  );
  
  const configPath = path.join(workspaceRoot, 'authord.config.json');

  // Load initial configuration
  let config: Config = loadConfig(configPath);
  let topicsDir = config['topics-dir'];
  let topicsPath = path.join(workspaceRoot, topicsDir);
  let topics: Topic[] = loadTopics(topicsPath);
  let instance = config.instance;
  let tocTree = parseTocElements(instance['toc-elements']);
  linkTopicsToToc(tocTree, topics);
  sortTocElements(tocTree);

  // Create and register tree data providers
  const documentationProvider = new DocumentationProvider(instance);
  vscode.window.registerTreeDataProvider('documentationsView', documentationProvider);

  let topicsProvider = new TopicsProvider(tocTree);
  vscode.window.registerTreeDataProvider('topicsView', topicsProvider);

  

  const deps = {
    tocTree,
    topicsProvider,
    documentationProvider,
    refreshConfiguration,
    refreshTopics,
    instance,
    topics, 
  };
  registerCommands(context, deps);

  // Watch for changes in topics directory
  const topicsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(topicsPath, '**/*.md'));
  topicsWatcher.onDidCreate(() => refreshTopics());
  topicsWatcher.onDidChange(() => refreshTopics());
  topicsWatcher.onDidDelete(() => refreshTopics());

  // Watch for changes in configuration
  const configWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, 'authord.json'));
  configWatcher.onDidChange(() => refreshConfiguration());

  // Add watchers to context subscriptions
  context.subscriptions.push(topicsWatcher);
  context.subscriptions.push(configWatcher);

  // Initialize sidebar view
  const sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('vs-code-sidebar', sidebarProvider)
  );

   // Listen for when the active editor changes
   context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        // Focus the existing preview if it's open
        await focusExistingPreview();
      }
    })
  );

  vscode.window.showInformationMessage('Authord Extension is now active!');
  
  // Define refresh functions with access to variables via closure
  function refreshTopics() {
    topics = loadTopics(topicsPath);
    linkTopicsToToc(tocTree, topics);
    topicsProvider.refresh(tocTree);
  }

  function refreshConfiguration() {
    config = loadConfig(configPath);
    topicsDir = config['topics-dir'];
    topicsPath = path.join(workspaceRoot, topicsDir);
    topics = loadTopics(topicsPath);
    instance = config.instance;
    tocTree = parseTocElements(instance['toc-elements']);
    linkTopicsToToc(tocTree, topics);
    sortTocElements(tocTree);
    documentationProvider.refresh(instance);
    topicsProvider.refresh(tocTree);
  }

  // Return the extendMarkdownIt function
  return {
    extendMarkdownIt(md: any) {
      // Apply your custom markdown-it plugins or rules here
      // For example, adding emoji support:
      // const emoji = require('markdown-it-plantuml');
      return md.use(require('markdown-it-plantuml'));
      // return md;
    },
  };
}

export function deactivate() {
  // Clean up resources if necessary
}

