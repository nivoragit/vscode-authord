import * as vscode from 'vscode';
import { loadTopics, linkTopicsToToc } from '../utils/helperFunctions';


export function initializeTopics(topicsPath: string, refreshTopics: () => void) {
  const topicsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(topicsPath, '**/*.md'));
  topicsWatcher.onDidCreate(refreshTopics);
  topicsWatcher.onDidChange(refreshTopics);
  topicsWatcher.onDidDelete(refreshTopics);

  return topicsWatcher;
}

export function refreshTopics(tocTree: any, topicsPath: string, topicsProvider: any) {
  const topics = loadTopics(topicsPath);
  linkTopicsToToc(tocTree, topics);
  topicsProvider.refresh(tocTree);
}
