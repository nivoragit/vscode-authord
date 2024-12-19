import * as vscode from 'vscode';
import { TocTreeItem } from '../utils/types';
import { AbstractConfigManager } from '../config/abstractConfigManager';
import * as path from 'path';
import * as fs from 'fs';

export class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TopicsItem | undefined | void> = new vscode.EventEmitter<TopicsItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicsItem | undefined | void> = this._onDidChangeTreeData.event;

  private tocTree: TocTreeItem[] = [];
  private currentDocId: string | undefined;
  private configManager: AbstractConfigManager;

  constructor(configManager: AbstractConfigManager) {
    this.configManager = configManager;
  }

  refresh(tocTree: TocTreeItem[], docId: string| undefined): void {
    this.tocTree = tocTree;
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

  async addTopic(parent?: TopicsItem): Promise<void> {
    let topicTitle = undefined;
    let safeFileName = undefined;
    const docDir = this.configManager.getTopicsDir();


    while (true) {
      topicTitle = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
      if (!topicTitle || !this.currentDocId) {
        vscode.window.showWarningMessage('Topic creation canceled.');
        return;

      }
      safeFileName = `${topicTitle.toLowerCase().replace(/\s+/g, '-')}.md`;
      const topicPath = path.join(docDir, safeFileName);
      if (!fs.existsSync(topicPath)) {
        break;
      }
      vscode.window.showInformationMessage(`Topic "${topicTitle}" already exists.`);
    }





    const newTopic: TocTreeItem = {
      topic: safeFileName,
      title: topicTitle,
      sortChildren: "none",
      children: []
    };

    if (parent) {
      parent.children.push(newTopic);
    } else {
      this.tocTree.push(newTopic);
    }

    this.configManager.addTopic(this.currentDocId, parent?.label as string || null, newTopic);
    this.refresh(this.tocTree, this.currentDocId);
  }

  async deleteTopic(item: TopicsItem) {
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

  async renameTopic(item: TopicsItem) {
    if (!this.currentDocId || !item.topic) {
      vscode.window.showWarningMessage('No topic selected or invalid document state.');
      return;
    }

    const newName = await vscode.window.showInputBox({ prompt: 'Enter new topic title', value: item.label as string });
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
        if (found) { return true; }
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
        if (found) { return true; }
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
