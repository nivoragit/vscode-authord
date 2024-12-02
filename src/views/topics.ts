import * as vscode from 'vscode';
import path from 'path';
import { loadTopics, linkTopicsToToc } from '../utils/helperFunctions';
import { refreshConfiguration } from '../commands/config';

function refreshTopics(tocTree: any, topicsPath: string, topicsProvider: any) {
  const topics = loadTopics(topicsPath);
  linkTopicsToToc(tocTree, topics);
  topicsProvider.refresh(tocTree);
}

export function setupWatchers(
  topicsPath: string,
  tocTree: any,
  topicsProvider: any,
  workspaceRoot: string,
  documentationProvider: any,
  context: vscode.ExtensionContext
) {
  // Watch for changes in topics directory
  const configPath = path.join(workspaceRoot, 'authord.config.json');
  const topicsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(topicsPath, '**/*.md'));
  topicsWatcher.onDidCreate(() => refreshTopics(tocTree, topicsPath, topicsProvider));
  topicsWatcher.onDidChange(() => refreshTopics(tocTree, topicsPath, topicsProvider));
  topicsWatcher.onDidDelete(() => refreshTopics(tocTree, topicsPath, topicsProvider));

  // Watch for changes in configuration
  const configWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, 'authord.config.json'));
  configWatcher.onDidChange(() => refreshConfiguration(configPath, workspaceRoot, documentationProvider, topicsProvider));

  // Add watchers to context subscriptions
  context.subscriptions.push(topicsWatcher);
  context.subscriptions.push(configWatcher);
}