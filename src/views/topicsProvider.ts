import * as vscode from 'vscode';
import { InstanceConfig, TocTreeItem } from '../utils/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TopicsItem | undefined | void> = new vscode.EventEmitter<TopicsItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicsItem | undefined | void> = this._onDidChangeTreeData.event;

  private tocTree: TocTreeItem[];
  private configPath: string;
  private topicsDir: string | undefined; // Directory where .md files are located
  private currentDocInstanceId: string | undefined;

  constructor(tocTree: TocTreeItem[], configPath: string) {
    this.tocTree = tocTree;
    this.configPath = configPath;

    // Initialize topics directory from config
    const configData = this.readConfigFile();
    if (configData && configData.topics && configData.topics.dir) {
      this.topicsDir = path.join(path.dirname(this.configPath), configData.topics.dir);
      if (!fs.existsSync(this.topicsDir)) {
        fs.mkdirSync(this.topicsDir, { recursive: true });
        fs.mkdirSync(path.join(path.dirname(this.configPath), 'trash'));
      }
    }
  }

  refresh(tocTree: TocTreeItem[], instanceId?: string): void {
    if (instanceId) { this.currentDocInstanceId = instanceId; }
    this.tocTree = tocTree;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TopicsItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TopicsItem): Thenable<TopicsItem[]> {
    if (!element) {
      // If no document is selected (e.g., tocTree is empty), show a placeholder
      if (!this.tocTree || this.tocTree.length === 0) {
        const noDocItem = new vscode.TreeItem('No document selected');
        noDocItem.contextValue = 'noDocSelected';
        noDocItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        return Promise.resolve([noDocItem as TopicsItem]);
      }

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
    treeItem.contextValue = 'topic';
    if (element.filePath) {
      treeItem.command = {
        command: 'authordExtension.openMarkdownFile',
        title: 'Open Markdown File',
        arguments: [element.filePath]
      };
    }
    return treeItem;
  }

  // Most efficient approach for adding a topic:
  // 1. Prompt user for title
  // 2. Check if document is selected; if not, show message and return
  // 3. Create a unique ID
  // 4. Create corresponding .md file
  // 5. Insert the new TocTreeItem in the correct position in tocTree
  // 6. Update config file
  async add(element?: TopicsItem): Promise<void> {
    // If no document selected, just return
    if (!this.tocTree || this.tocTree.length === 0) {
      vscode.window.showInformationMessage('No document selected. Cannot create a new topic.');
      return;
    }

    const title = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });

    if (!title) {
      vscode.window.showWarningMessage('Topic creation canceled.');
      return;
    }

    // Create a new .md file for the topic
    const newId = uuidv4();
    const safeFileName = title.toLowerCase().replace(/\s+/g, '-');

    const filePath = path.join(this.topicsDir || '', `${safeFileName}.md`);
    const newTopic: TocTreeItem = {
      id: newId,
      title: title,
      filePath: filePath,
      sortChildren: "none",
      children: []
    };
    if (element && element.id && this.findAndAdd(element.id, this.tocTree, newTopic, safeFileName)) {
      vscode.window.showErrorMessage('Topic added to dir');
    } else {
      // Add at the root level
      this.tocTree.push(newTopic);
    }
    try {

      fs.writeFileSync(filePath, `# ${title}\n\nContent goes here...`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to create topic file: ${err}`);
      return;
    }

    this.refresh(this.tocTree);
    this.updateConfigFile();
  }

  // Most efficient approach for deleting a topic:
  // 1. Remove it from tocTree
  // 2. Delete corresponding .md file
  // 3. Update config file
  deleteTopic(element: TopicsItem): void {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to delete topic: ID is missing.');
      return;
    }

    const topicToDelete = this.findTopicById(element.id, this.tocTree);
    if (!topicToDelete) {
      vscode.window.showErrorMessage('Topic not found.');
      return;
    }

    // Delete the associated .md file if it exists
    if (topicToDelete.filePath && fs.existsSync(topicToDelete.filePath)) {
      try {
        fs.unlinkSync(topicToDelete.filePath);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to delete topic file: ${err}`);
      }
    }

    // Remove from tocTree
    this.removeTopicById(element.id, this.tocTree);
    this.refresh(this.tocTree);
    this.updateConfigFile();
  }

  async renameTopic(element: TopicsItem): Promise<void> {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to rename topic: ID is missing.');
      return;
    }
    const newName = await vscode.window.showInputBox({ prompt: 'Enter New Title' });
    if (!newName) {
      vscode.window.showWarningMessage('Doc rename canceled.');
      return;
    }
    const topicToRename = this.findAndRename(element.id, this.tocTree,newName);
    if (!topicToRename) {
      vscode.window.showErrorMessage('Topic not found.');
      return;
    }


    this.refresh(this.tocTree);
    this.updateConfigFile();
  }

  // Helper method to update config.json
  private updateConfigFile(): void {
    const configData = this.readConfigFile();

    if (configData && configData.instances && configData.instances.length > 0) {
      let instanceFound = false;

      for (const instance of configData.instances) {
        if (instance.id === this.currentDocInstanceId) {
          instance["toc-elements"] = this.convertTocTreeToTocElements(this.tocTree);
          instanceFound = true;
          break;
        }
      }

      if (instanceFound) {
        // Write the updated configData back to the file
        fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2));
      } else {
        vscode.window.showErrorMessage(
          `Instance with ID ${this.currentDocInstanceId} not found in config.`
        );
      }
    } else {
      vscode.window.showErrorMessage('No instances found in config to update.');
    }
  }



  private convertTocTreeToTocElements(tocTree: TocTreeItem[]): any[] {
    return tocTree.map(item => {
      return {
        id: item.id,
        "topic": item.filePath ? path.basename(item.filePath) : "",
        "toc-title": item.title,
        "sort-children": item.sortChildren,
        "children": this.convertTocTreeToTocElements(item.children || [])
      };
    });
  }

  // Helper method to read config.json
  private readConfigFile(): any {
    try {
      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      vscode.window.showErrorMessage('Error reading config.json');
      return { instances: [], topics: { dir: "topics" } };
    }
  }

  // Helper method to find a topic by ID
  private findTopicById(id: string, topics: TocTreeItem[]): TocTreeItem | undefined {
    for (const topic of topics) {
      if (topic.id === id) {
        return topic;
      } else if (topic.children) {
        const found = this.findTopicById(id, topic.children);
        if (found) { return found; }
      }
    }
    return undefined;
  }
  private findAndAdd(id: string, topics: TocTreeItem[], newTopic: TocTreeItem, safeFileName: string): boolean{
    for (const topic of topics) {
      if (topic.id === id) {
        const filePath = path.join(path.dirname(topic.filePath || path.dirname(this.configPath)) || '', `${safeFileName}.md`);
        newTopic.filePath = filePath;
        topic.children.push(newTopic);
        return true;
      } else if (topic.children) {
        this.findAndAdd(id, topic.children, newTopic, safeFileName);
        return true;
      }
    }
    return false;

  }

  private findAndRename(id: string, topics: TocTreeItem[], newName: string): boolean {
    for (const topic of topics) {
      if (topic.id === id) {
        topic.title = newName;
        return true;
      } else if (topic.children) {
        this.findAndRename(id, topic.children,newName);
        return true;
      }
    }
    return false;

  }

  // Helper method to remove a topic by ID
  private removeTopicById(id: string, topics: TocTreeItem[]) {
    const index = topics.findIndex(topic => topic.id === id);
    if (index > -1) {
      topics.splice(index, 1);
      return;
    } else {
      for (const topic of topics) {
        if (topic.children) {
          const removed = this.removeTopicById(id, topic.children);
          if (removed) { return; }
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
    this.contextValue = 'topic';
  }
}
