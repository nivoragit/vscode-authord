import * as vscode from 'vscode';
import { TocTreeItem } from '../utils/types';
import { AbstractConfigManager } from '../config/abstractConfigManager';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TopicsItem | undefined | void> = new vscode.EventEmitter<TopicsItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicsItem | undefined | void> = this._onDidChangeTreeData.event;

  private tocTree: TocTreeItem[];
  private currentDocInstanceId: string | undefined;
  private configManager: AbstractConfigManager;
  private topicsDir: string | undefined;

  constructor(tocTree: TocTreeItem[], configManager: AbstractConfigManager) {
    this.tocTree = tocTree;
    this.configManager = configManager;


    const configData = (this.configManager as any)['configData']; // Adjust accessor if needed
    if (configData && configData.topics && configData.topics.dir) {
      this.topicsDir = path.join(path.dirname(this.configManager.configPath), configData.topics.dir);
      this.configManager.createDirectory(this.topicsDir);
      this.configManager.createDirectory(path.join(path.dirname(this.configManager.configPath), 'trash'));
    }
  }

  refresh(tocTree: TocTreeItem[], instanceId?: string): void {
    if (instanceId) { 
      this.currentDocInstanceId = instanceId; 
    }
    this.tocTree = tocTree;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TopicsItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TopicsItem): Thenable<TopicsItem[]> {
    if (!element) {
      if (!this.tocTree || this.tocTree.length === 0) {
        const noDocItem = new vscode.TreeItem('No document selected');
        noDocItem.contextValue = 'noDocSelected';
        noDocItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        return Promise.resolve([noDocItem as TopicsItem]);
      }
      return Promise.resolve(this.tocTree.map(item => this.createTreeItem(item)));
    } else {
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

    const filePath = this.configManager.getFilePathById(element.id);
    if (filePath) {
      treeItem.command = {
        command: 'authordExtension.openMarkdownFile',
        title: 'Open Markdown File',
        arguments: [filePath]
      };
    }
    return treeItem;
  }

  async addTopic(element?: TopicsItem): Promise<void> {
    if (!this.currentDocInstanceId) {
      vscode.window.showInformationMessage('No document selected. Cannot create a new topic.');
      return;
    }
  
    const title = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
    if (!title) {
      vscode.window.showWarningMessage('Topic creation canceled.');
      return;
    }
  
    const newId = uuidv4();
    const safeFileName = `${title.toLowerCase().replace(/\s+/g, '-')}.md`;
    const docPath = this.getDocPath();
    const topicFolderName = title.toLowerCase().replace(/\s+/g, '-');
  
    let parentDir = docPath;
    if (element && element.id) {
      const parentFilePath = this.configManager.getFilePathById(element.id);
      if (parentFilePath) {
        parentDir = path.join(path.dirname(parentFilePath), topicFolderName);
      } else {
        parentDir = path.join(docPath, topicFolderName);
      }
    } else {
      parentDir = path.join(docPath, topicFolderName);
    }
  
    const filePath = path.join(parentDir, safeFileName);
    this.configManager.createDirectory(parentDir);
    this.configManager.writeFile(filePath, `# ${title}\n\nContent goes here...`);
  
    const newTopic: TocTreeItem = {
      id: newId,
      title: title,
      sortChildren: "none",
      children: []
    };

    if (element && element.id) {
      this.findAndAddTopicToParent(element.id, this.tocTree, newTopic);
    } else {
      this.tocTree.push(newTopic);
    }

    const tocElement = {
      id: newId,
      topic: path.basename(filePath),
      "toc-title": title,
      "sort-children": "none",
      children: []
    };
    this.configManager.addTopic(this.currentDocInstanceId, element?.id || null, tocElement);
    this.configManager.setFilePathById(newId, filePath);
  }

  deleteTopic(element: TopicsItem): void {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to delete topic: ID is missing.');
      return;
    }

    const filePath = this.configManager.getFilePathById(element.id);
    if (!filePath || !this.configManager.fileExists(filePath)) {
      vscode.window.showErrorMessage('Topic file not found or missing in file-paths.');
      return;
    }

    const sourceDir = path.dirname(filePath);
    this.configManager.moveFolderToTrash(sourceDir);

    this.removeTopicById(element.id, this.tocTree);
    if (this.currentDocInstanceId) {
      this.configManager.deleteTopic(this.currentDocInstanceId, element.id);
    }
    this.configManager.removeFilePathById(element.id);
  }

  async renameTopic(element: TopicsItem): Promise<void> {
    if (!element.id) {
      vscode.window.showErrorMessage('Unable to rename topic: ID is missing.');
      return;
    }
  
    const newName = await vscode.window.showInputBox({ prompt: 'Enter New Title' });
    if (!newName) {
      vscode.window.showWarningMessage('Topic rename canceled.');
      return;
    }
  
    const oldFilePath = this.configManager.getFilePathById(element.id);
    if (!oldFilePath || !this.configManager.fileExists(oldFilePath)) {
      vscode.window.showErrorMessage('Topic file not found or missing in file-paths.');
      return;
    }
  
    const oldFolderPath = path.dirname(oldFilePath);
    const oldFileName = path.basename(oldFilePath);
    const oldFileNameWithoutExt = path.basename(oldFileName, '.md');
    const fileNameParts = oldFileNameWithoutExt.split('-');
    const topicUuid = fileNameParts[fileNameParts.length - 1];
  
    const newFolderName = newName.toLowerCase().replace(/\s+/g, '-');
    const newFileName = `${newFolderName}-${topicUuid}.md`;
  
    try {
      const parentDir = path.dirname(oldFolderPath);
      const newFolderPath = path.join(parentDir, newFolderName);
  
      this.configManager.renamePath(oldFolderPath, newFolderPath);
  
      const oldFileFullPath = path.join(newFolderPath, oldFileName);
      const newFilePath = path.join(newFolderPath, newFileName);
      this.configManager.renamePath(oldFileFullPath, newFilePath);
  
      const topicRenamed = this.findAndRename(element.id, this.tocTree, newName);
      if (!topicRenamed) {
        vscode.window.showErrorMessage('Topic not found in memory.');
        return;
      }

      this.configManager.setFilePathById(element.id, newFilePath);
      if (this.currentDocInstanceId) {
        this.configManager.renameTopic(this.currentDocInstanceId, element.id, newName);
      }
  
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to rename topic: ${error.message}`);
    }
  }

  private getDocPath(): string {
    return this.topicsDir!;
  }

  private findAndAddTopicToParent(parentId: string, topics: TocTreeItem[], newTopic: TocTreeItem): boolean {
    for (const topic of topics) {
      if (topic.id === parentId) {
        topic.children.push(newTopic);
        return true;
      } else if (topic.children && topic.children.length > 0) {
        if (this.findAndAddTopicToParent(parentId, topic.children, newTopic)) {
          return true;
        }
      }
    }
    return false;
  }

  private removeTopicById(id: string, topics: TocTreeItem[]) {
    const index = topics.findIndex(topic => topic.id === id);
    if (index > -1) {
      topics.splice(index, 1);
      return true;
    }
    for (const topic of topics) {
      if (topic.children) {
        const removed = this.removeTopicById(id, topic.children);
        if (removed) { return true; }
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
        const renamed = this.findAndRename(id, topic.children, newName);
        if (renamed) { return true; }
      }
    }
    return false;
  }
}

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


