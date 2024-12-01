import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { AuthordViewProvider } from './views/authordViewProvider';
import { focusExistingPreview, linkTopicsToToc, onConfigExists, parseTocElements, sortTocElements} from './utils/helperFunctions';
import { initializeConfig} from './commands/config';
import { DocumentationProvider } from './views/documentationProvider';
import { TopicsProvider } from './views/topicsProvider';
import { setupWatchers } from './views/topics';

export function activate(context: vscode.ExtensionContext) {
  // Get the workspace root
  if (!vscode.workspace.workspaceFolders) { return; }
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

  // Listen for when the active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        // Focus the existing preview if it's open
        await focusExistingPreview();
      }
    })
  );

  // Register the Authord Documentation View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AuthordViewProvider.viewType, // ID from package.json
      new AuthordViewProvider(context, workspaceRoot)
    )
  );

  registerCommands(context);

  const disposable = onConfigExists(() => {
    initializeExtension(context, workspaceRoot);
    disposable.dispose(); // Clean up the event listener after initialization
  });
  context.subscriptions.push(disposable);
  
// Return the extendMarkdownIt function
return {
  extendMarkdownIt(md: any) {
    // Apply your custom markdown-it plugins or rules here
    // For example, adding PlantUML support:
    return md.use(require('markdown-it-plantuml'));
  },
};
  
}

export function deactivate() {
  // Clean up resources if necessary
}

function initializeExtension(context: vscode.ExtensionContext, workspaceRoot: string) {

  let {
        topicsPath,
        instances,
        tocTree,
        topics
      } = initializeConfig(workspaceRoot);

  // Create and register tree data providers
  const documentationProvider = new DocumentationProvider(instances);
  vscode.window.registerTreeDataProvider('documentationsView', documentationProvider);

  let topicsProvider = new TopicsProvider();
  vscode.window.registerTreeDataProvider('topicsView', topicsProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('authordDocsExtension.selectInstance', (instanceId) => {
      // For now, only one instance is available
      tocTree = instances.flatMap(instance => 
        instance.id === instanceId ? parseTocElements(instance['toc-elements']) : []
    );
      linkTopicsToToc(tocTree, topics); // 'instance' and 'topics' are now defined
      sortTocElements(tocTree);
      topicsProvider.refresh(tocTree);
    })
  );

  setupWatchers(topicsPath,tocTree,topicsProvider,workspaceRoot,documentationProvider,context);
  
  vscode.window.showInformationMessage('Authord Extension is now active!');
    
}
