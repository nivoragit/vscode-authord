import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { loadTopics, parseTocElements, linkTopicsToToc, sortTocElements } from '../utils/helperFunctions';
import { Config, Topic } from '../utils/types';


export function initializeConfig(workspaceRoot: string) {
  const configPath = path.join(workspaceRoot, 'authord.json');
  let config: Config = loadConfig(configPath);
  let topicsDir = config['topics-dir'];
  let topicsPath = path.join(workspaceRoot, topicsDir);
  let topics: Topic[] = loadTopics(topicsPath);
  let instance = config.instance;
  let tocTree = parseTocElements(instance['toc-elements']);
  linkTopicsToToc(tocTree, topics);
  sortTocElements(tocTree);

  return { config, topicsDir, topicsPath, instance, tocTree, topics };
}

export function refreshConfiguration(
  workspaceRoot: string,
  documentationProvider: any,
  topicsProvider: any
) {
  const { config, topicsPath, instance, tocTree, topics } = initializeConfig(workspaceRoot);
  documentationProvider.refresh(instance);
  topicsProvider.refresh(tocTree);
}

export function loadConfig(configPath: string): Config {
  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configContent);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Error reading authord.json: ${error.message}`);
    throw error;
  }
}
