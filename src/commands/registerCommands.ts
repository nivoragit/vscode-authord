// src/commands/registerCommands.ts
import * as vscode from 'vscode';
import { showMarkdownPreview } from '../views/markdownPreview.js';
import { TopicItem } from '../views/topicItem.js';
import { readConfiguration } from './readConfig.js';
import { MyTreeDataProvider } from '../views/myTreeDataProvider.js';
import { checkConfigFile } from '../utils/helperFunctions.js';


export function registerCommands(context: vscode.ExtensionContext) {

    const treeDataProvider = new MyTreeDataProvider();
    vscode.window.registerTreeDataProvider('myExtensionView', treeDataProvider);

    context.subscriptions.push(
    vscode.commands.registerCommand('myExtension.checkConfig', checkConfigFile));

    const readConfigDisposable = vscode.commands.registerCommand('writerjet.readConfig', readConfiguration);
    context.subscriptions.push(readConfigDisposable);

    const markdownPreviewCommandDisposable = vscode.commands.registerCommand('writerjet.showPreview', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'markdown') {
          showMarkdownPreview(context, editor.document);
        } else {
          vscode.window.showErrorMessage('Open a Markdown file to preview.');
        }
      });
      context.subscriptions.push(markdownPreviewCommandDisposable);



    
}


