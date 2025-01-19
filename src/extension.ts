// src/extension.ts
import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { SidebarProvider } from './views/sidebarView';
import { TopicProvider } from './views/topicProvider';

export function activate(context: vscode.ExtensionContext) {   
    // Register commands
    registerCommands(context);  

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


     // Optional: Add a refresh command
    context.subscriptions.push(
        vscode.commands.registerCommand('writerjet.refreshTopics', () => topicProvider.refresh())
     );

     vscode.window.showInformationMessage('Your Extension is now active!');


 }

export function deactivate() {
    // Clean up resources if necessary
}
