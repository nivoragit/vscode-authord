import * as vscode from 'vscode';
import { TocTreeItem } from '../utils/types';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TopicsItem | undefined | void> = new vscode.EventEmitter<TopicsItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicsItem | undefined | void> = this._onDidChangeTreeData.event;

  private tocTree: TocTreeItem[];
  private configPath: string;

  constructor(tocTree: TocTreeItem[], configPath: string) {
    this.tocTree = tocTree;
    this.configPath = configPath;
  }

  refresh(tocTree: TocTreeItem[]): void {
    this.tocTree = tocTree;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TopicsItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TopicsItem): Thenable<TopicsItem[]> {
    if (!element) {
      // Root elements
      return Promise.resolve(this.tocTree.map(item => this.createTreeItem(item)));
    } else {
      // Children of the element
      return Promise.resolve(
        element.children.map(item => this.createTreeItem(item))
      );
    }
  }

  private createTreeItem(element: TocTreeItem): TopicsItem {
    const hasChildren = element.children && element.children.length > 0;
    const treeItem = new TopicsItem(
      element.title,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      element.children
    );
    treeItem.id = element.id;
    treeItem.children = element.children;
    treeItem.contextValue = 'topic'; // Set contextValue to 'topic'
    if (element.filePath) {
      treeItem.command = {
        command: 'authordExtension.openMarkdownFile',
        title: 'Open Markdown File',
        arguments: [element.filePath]
      };
    }
    return treeItem;
  }

  // Method to add a new topic
  async addTopic(element?: TopicsItem): Promise<void> {
    const title = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
  
    // Exit the function if title is undefined (user canceled input)
    if (!title) {
      vscode.window.showWarningMessage('Topic creation canceled.');
      return;
    }
  
    const newTopic: TocTreeItem = {
      id: uuidv4(),
      title, // Now guaranteed to be a string
      children: [],
      sortChildren: "none" // Assuming "none" is an acceptable default value
    };
  
    if (element && element.id) {
      // Add as a child to the selected topic
      const parentTopic = this.findTopicById(element.id, this.tocTree);
      if (parentTopic) {
        parentTopic.children.push(newTopic);
      }
    } else {
      // Add at the root level
      this.tocTree.push(newTopic);
    }
  
    this.refresh(this.tocTree);
    this.updateConfigFile();
  }
  

  // Method to delete a topic
  deleteTopic(element: TopicsItem): void {
    if (element.id) {
      this.removeTopicById(element.id, this.tocTree);
      this.refresh(this.tocTree);
      this.updateConfigFile();
    } else {
      vscode.window.showErrorMessage('Unable to delete topic: ID is missing.');
    }
  }
  

  // Helper method to update config.json
  private updateConfigFile(): void {
    const configData = this.readConfigFile();
    configData.tocTree = this.tocTree;
    fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
  }

  // Helper method to read config.json
  private readConfigFile(): any {
    try {
      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      vscode.window.showErrorMessage('Error reading config.json');
      return { tocTree: [] };
    }
  }

  // Helper method to find a topic by ID
  private findTopicById(id: string, topics: TocTreeItem[]): TocTreeItem | undefined {
    for (const topic of topics) {
      if (topic.id === id) {
        return topic;
      } else if (topic.children) {
        const found = this.findTopicById(id, topic.children);
        if (found) {return found;}
      }
    }
    return undefined;
  }

  // Helper method to remove a topic by ID
  private removeTopicById(id: string, topics: TocTreeItem[]): boolean {
    const index = topics.findIndex(topic => topic.id === id);
    if (index > -1) {
      topics.splice(index, 1);
      return true;
    } else {
      for (const topic of topics) {
        if (topic.children) {
          const removed = this.removeTopicById(id, topic.children);
          if (removed) return true;
        }
      }
    }
    return false;
  }
}

// Define the TopicsItem class
export class TopicsItem extends vscode.TreeItem {
  children: TocTreeItem[];

  constructor(
    public readonly label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState,
    children: TocTreeItem[] = []
  ) {
    super(label, collapsibleState);
    this.children = children;
    this.contextValue = 'topic'; // Set contextValue to 'topic'
  }
}
