import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs'; // Updated to use fs.promises for async operations
import { TocTreeItem } from '../utils/types';
import { AbstractConfigManager, TocElement } from '../config/abstractConfigManager';
import { DocumentationItem } from './documentationProvider';

export class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TopicsItem | undefined | void> = new vscode.EventEmitter<TopicsItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicsItem | undefined | void> = this._onDidChangeTreeData.event;
  private tocTree: TocTreeItem[] = [];
  private configManager: AbstractConfigManager;
  currentDocId: string | undefined;
  constructor(configManager: AbstractConfigManager) {
    this.configManager = configManager;
  }

  refresh(tocTree: TocTreeItem[]| null, docId: string | undefined): void {
    if(tocTree){this.tocTree = tocTree;} 
    this.currentDocId = docId;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TopicsItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TopicsItem): Thenable<TopicsItem[]> {
    if (!element) {
      return Promise.resolve(this.tocTree.map(item => this.createTreeItem(item)));
    }
    return Promise.resolve(element.children.map(child => this.createTreeItem(child)));
  }

  private createTreeItem(item: TocTreeItem): TopicsItem {
    const hasChildren = item.children && item.children.length > 0;
    const treeItem = new TopicsItem(
      item.title,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      item.children,
      item.topic
    );
    treeItem.command = {
      command: 'authordExtension.openMarkdownFile',
      title: 'Open Topic',
      arguments: [path.join(this.configManager.getTopicsDir(), item.topic)]
    };
    return treeItem;
  }

  async rootTopic(element: DocumentationItem): Promise<void> {
    if (element && !this.currentDocId) {
      this.currentDocId = element.id;
    }

    if (!this.currentDocId) {
      vscode.window.showWarningMessage('No active document to add a root topic to.');
      return;
    }

    // Prompt for the topic title
    const topicTitle = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
    if (!topicTitle) {
      vscode.window.showWarningMessage('Root topic creation canceled.');
      return;
    }

    // Generate the default file name (lowercase with hyphens)
    const defaultFileName = `${topicTitle.toLowerCase().replace(/\s+/g, '-')}.md`;

    // Prompt the user for the file name, pre-populated with the default
    const enteredFileName = await vscode.window.showInputBox({
      prompt: 'Enter file name',
      value: defaultFileName
    });
    if (!enteredFileName) {
      vscode.window.showWarningMessage('Root topic creation canceled.');
      return;
    }

    const docDir = this.configManager.getTopicsDir();
    const topicPath = path.join(docDir, enteredFileName);

    // Check if the file already exists
    try {
      await fs.access(topicPath);
      vscode.window.showInformationMessage(`File "${enteredFileName}" already exists. Please choose a different file name.`);
      return;
    } catch {
      // File does not exist; safe to proceed
    }

    // Create the new root topic
    const newTopic: TocElement = {
      topic: enteredFileName,
      title: topicTitle,
      sortChildren: "none",
      children: []
    };

    this.configManager.addTopic(this.currentDocId as string, null, newTopic);
    this.tocTree.push(newTopic);
    this._onDidChangeTreeData.fire();
  }

  private parseTocElements(tocElements: TocElement[]): TocTreeItem[] {
    return tocElements.map(element => {
      const children = element.children ? this.parseTocElements(element.children) : [];
      return {
        title: element.title,
        topic: element.topic,
        sortChildren: element.sortChildren,
        children,
      };
    });
  }
    // This is the most efficient approach for prompting the title first, then letting the user edit the default file name.
    async addTopic(parent?: TopicsItem): Promise<void> {
      if (!this.currentDocId) {
        vscode.window.showWarningMessage('No active document to add a topic to.');
        return;
      }
  
      // Prompt for the topic title
      const topicTitle = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
      if (!topicTitle) {
        vscode.window.showWarningMessage('Topic creation canceled.');
        return;
      }
  
      // Generate the default file name (lowercase with hyphens)
      const defaultFileName = `${topicTitle.toLowerCase().replace(/\s+/g, '-')}.md`;
  
      // Prompt the user for the file name, pre-populated with the default
      const enteredFileName = await vscode.window.showInputBox({
        prompt: 'Enter file name',
        value: defaultFileName
      });
      if (!enteredFileName) {
        vscode.window.showWarningMessage('Topic creation canceled.');
        return;
      }
  
      const docDir = this.configManager.getTopicsDir();
      const topicPath = path.join(docDir, enteredFileName);
  
      // Check if the file already exists
      try {
        await fs.access(topicPath);
        vscode.window.showInformationMessage(`File "${enteredFileName}" already exists. Please choose a different file name.`);
        return;
      } catch {
        // File does not exist; safe to proceed
      }
  
      // Create the new topic
      const newTopic: TocTreeItem = {
        topic: enteredFileName,
        title: topicTitle,
        sortChildren: "none",
        children: []
      };
  
      // Add to either the parent or root
      if (parent) {
        parent.children.push(newTopic);
      } else {
        this.tocTree.push(newTopic);
      }
  
      this.configManager.addTopic(this.currentDocId, parent?.label as string || null, newTopic);
      this._onDidChangeTreeData.fire();
    }
  
  async deleteTopic(item: TopicsItem): Promise<void> {
    if (!this.currentDocId || !item.topic) {
      vscode.window.showWarningMessage('No topic selected or invalid document state.');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete topic "${item.label}"?`,
      { modal: true },
      'Yes'
    );
    if (confirm !== 'Yes') {
      return;
    }

    this.configManager.deleteTopic(this.currentDocId, item.topic);
    this.removeTopicFromTree(item.topic, this.tocTree);
    this.refresh(this.tocTree, this.currentDocId);
  }

  async renameTopic(item: TopicsItem): Promise<void> {
    if (!this.currentDocId || !item.topic) {
      vscode.window.showWarningMessage('No topic selected or invalid document state.');
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new topic title',
      value: item.label as string
    });
    if (!newName) {
      vscode.window.showWarningMessage('Topic rename canceled.');
      return;
    }

    this.configManager.renameTopic(this.currentDocId, item.topic, newName);
    this.renameTopicInTree(item.topic, newName, this.tocTree);
    this.refresh(this.tocTree, this.currentDocId);
  }

  private removeTopicFromTree(topicId: string, tree: TocTreeItem[]): boolean {
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].topic === topicId) {
        tree.splice(i, 1);
        return true;
      }
      if (tree[i].children && tree[i].children.length > 0) {
        const found = this.removeTopicFromTree(topicId, tree[i].children);
        if (found) {
          return true;
        }
      }
    }
    return false;
  }

  private renameTopicInTree(topicId: string, newName: string, tree: TocTreeItem[]): boolean {
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].topic === topicId) {
        tree[i].title = newName;
        return true;
      }
      if (tree[i].children && tree[i].children.length > 0) {
        const found = this.renameTopicInTree(topicId, newName, tree[i].children);
        if (found) {
          return true;
        }
      }
    }
    return false;
  }
}

export class TopicsItem extends vscode.TreeItem {
  children: TocTreeItem[];
  topic: string;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    children: TocTreeItem[] = [],
    topic: string
  ) {
    super(label, collapsibleState);
    this.children = children;
    this.contextValue = 'topic';
    this.topic = topic;
  }
}
