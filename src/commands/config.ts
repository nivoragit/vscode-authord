import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { loadTopics, parseTocElements, linkTopicsToToc, sortTocElements, setConfigValid } from '../utils/helperFunctions';
import { Config, TocTreeItem, Topic } from '../utils/types';
import { DocumentationProvider } from '../views/documentationProvider';
import { TopicsProvider } from '../views/topicsProvider';



export function initializeConfig(workspaceRoot: string) {
  const configPath = path.join(workspaceRoot, 'authord.config.json');
  const config: Config = loadConfig(configPath);
  const topicsDir = config['topics']['dir'];
  const topicsPath = path.join(workspaceRoot, topicsDir);
  const topics: Topic[] = loadTopics(topicsPath);
  const instances = config.instances;
  const tocTree: TocTreeItem[] = [];
  
  return {topicsPath, instances, tocTree, topics };
}
export function refreshConfiguration(configPath: string, workspaceRoot: string, documentationProvider:DocumentationProvider , topicsProvider:TopicsProvider) {
    try {
      const config = loadConfig(configPath);
      const topicsDir = config['topics']['dir'];
      const topicsPath = path.join(workspaceRoot, topicsDir);
      const topics = loadTopics(topicsPath);
      const instances = config.instances;
      const tocTree = instances.flatMap(instance => parseTocElements(instance['toc-elements']));
      linkTopicsToToc(tocTree, topics);
      sortTocElements(tocTree);
      documentationProvider.refresh(instances);
      topicsProvider.refresh(tocTree);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to reload Configurations: ${error.message}`);
      setConfigValid(false);
      return;
    }
    
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



