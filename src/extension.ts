// src/extension.ts
import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands.js';
import { SidebarProvider } from './views/sidebarView.js';
import { TopicProvider } from './views/topicProvider.js';
import { showMarkdownPreview } from './views/markdownPreview.js';
// import { registerCommands } from './commands/registerCommands';
// import { SidebarProvider } from './views/sidebarView';
// import { TopicProvider } from './views/topicProvider';

export function activate(context: vscode.ExtensionContext) {   
    // Register commands
    registerCommands(context);  

    vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === 'markdown') {
          showMarkdownPreview(context, document);
        }
      });

      
    // Initialize sidebar view
    const sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('vs-code-sidebar', sidebarProvider)
      );
    
     // Register the Topic Tree View
    const topicProvider = new TopicProvider();
    vscode.window.registerTreeDataProvider('writerjet.topicTreeView', topicProvider);
    
    // Listen for configuration changes and refresh the Tree View
    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('writerjet.topics')) {
            topicProvider.refresh();
        }
    });

     vscode.window.showInformationMessage('Your Extension is now active!');


 }

export function deactivate() {
    // Clean up resources if necessary
}
