// src/commands/registerCommands.ts
import * as vscode from 'vscode';
// import { showMarkdownPreview } from '../views/markdownPreview';
// import { TopicItem } from '../views/topicItem';
// import { readConfiguration } from './readConfig';
import { showMarkdownPreview } from '../views/markdownPreview.js';
import { TopicItem } from '../views/topicItem.js';
import { readConfiguration } from './readConfig.js';
// import { TopicItem } from '../views/topicItem';
// import { TopicProvider } from '../views/topicProvider';
// import { readConfiguration } from './readConfig';
// import { showMarkdownPreview } from '../views/markdownPreview';


export function registerCommands(context: vscode.ExtensionContext) {
    const helloCommand = vscode.commands.registerCommand('writerjet.sayHello', () => {
        vscode.window.showInformationMessage('Hello from Your Extension!');
    });
    context.subscriptions.push(helloCommand);

    const openTopicCommand = vscode.commands.registerCommand('writerjet.openTopic', async (item?: TopicItem) => {
        if (!item) {
            // If no item is provided, let the user pick from a list of topics
            // const config = vscode-writerjet.workspace.getConfiguration('vscode-writerjet');
            // const topics = config.get<string[]>('topics') || [];
            const topics = [
                "Topic 1",
                "Topic 2",
                "Topic 3"
            ];
            const selectedTopic = await vscode.window.showQuickPick(topics, {
                placeHolder: 'Select a topic to open'
            });
    
            if (selectedTopic) {
                vscode.window.showInformationMessage(`Opened: ${selectedTopic}`);
            } else {
                vscode.window.showWarningMessage('No topic selected.');
            }
            return;
        }
    
        // When invoked with an item, use its label
        vscode.window.showInformationMessage(`Opened: ${item.label}`);
    });
    context.subscriptions.push(openTopicCommand);

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
    
      // Add subscriptions
      context.subscriptions.push(markdownPreviewCommandDisposable);



    
}
