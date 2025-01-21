/* eslint-disable import/no-unresolved */
import * as vscode from 'vscode';
import * as path from 'path';
import { TocElement } from '../utils/types';
import TopicsItem from './topicsItem';
import TopicsService from './TopicsService';

export default class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<TopicsItem | undefined | void>();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public readonly topicsService: TopicsService;

  private readonly topicsDir: string;

  private tocTree: TocElement[] = [];

  public currentDocId: string | undefined;

  constructor(topicsService: TopicsService) {
    this.topicsService = topicsService;
    this.topicsDir = topicsService.topicDir;
  }

  public refresh(tocTree?: TocElement[], docId?: string): void {
    if (tocTree) {
      this.tocTree = tocTree;
    }
    if (docId) {
      this.currentDocId = docId;
    }
    this.onDidChangeTreeDataEmitter.fire();
  }

  // Using an eslint-disable here because we must implement getTreeItem() for the interface,
  // but we don't need 'this' in the implementation.
  // eslint-disable-next-line class-methods-use-this
  public getTreeItem(element: TopicsItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: TopicsItem): Promise<TopicsItem[]> {
    if (!element) {
      return this.tocTree.map((item) => this.createTreeItem(item));
    }
    return element.children.map((child) => this.createTreeItem(child));
  }

  private createTreeItem(item: TocElement): TopicsItem {
    const collapsibleState = item.children?.length
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const treeItem = new TopicsItem(
      item.title,
      collapsibleState,
      item.topic,
      item.children
    );
    treeItem.command = {
      command: 'authordExtension.openMarkdownFile',
      title: 'Open Topic',
      arguments: [path.join(this.topicsDir, item.topic)],
    };
    return treeItem;
  }

  public async moveTopic(sourceTopicId: string, targetTopicId: string): Promise<void> {
    if (!this.currentDocId) return;

    const newTocTree = await this.topicsService.moveTopic(
      this.currentDocId,
      sourceTopicId,
      targetTopicId
    );
    if (newTocTree.length === 0) {
      return; // Possibly no valid target
    }
    this.refresh(newTocTree);
  }

  public async addRootTopic(): Promise<void> {
    if (!this.currentDocId) {
      vscode.window.showWarningMessage('No active document to add a topic to.');
      return;
    }

    const newTopic = await TopicsProvider.createTopic();
    if (!newTopic) return;

    const success = await this.topicsService.addChildTopic(this.currentDocId, null, newTopic);
    if (!success) {
      vscode.window.showWarningMessage('Failed to add root topic.');
      return;
    }
    this.onDidChangeTreeDataEmitter.fire();
  }

  public async addChildTopic(parent?: TopicsItem): Promise<void> {
    if (!this.currentDocId) {
      vscode.window.showWarningMessage('No active document to add a topic to.');
      return;
    }

    const newTopic = await TopicsProvider.createTopic();
    if (!newTopic) return;

    if (parent) {
      // eslint-disable-next-line no-param-reassign
      parent.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      // eslint-disable-next-line no-param-reassign
      parent.children.push(newTopic);
    } else {
      this.tocTree.push(newTopic);
    }

    const success = await this.topicsService.addChildTopic(
      this.currentDocId,
      parent?.topic || null,
      newTopic
    );
    if (!success) {
      vscode.window.showWarningMessage('Failed to add child topic.');
      return;
    }
    this.onDidChangeTreeDataEmitter.fire();
  }

  public async addSiblingTopic(sibling?: TopicsItem): Promise<void> {
    if (!this.currentDocId || !sibling) {
      vscode.window.showWarningMessage('Invalid sibling/topic or no active document.');
      return;
    }

    const newTopic = await TopicsProvider.createTopic();
    if (!newTopic) return;

    const success = await this.topicsService.addSiblingTopic(
      this.currentDocId,
      sibling.topic,
      newTopic
    );
    if (!success) {
      vscode.window.showWarningMessage('Failed to add sibling topic.');
      return;
    }
    this.onDidChangeTreeDataEmitter.fire();
  }

  public async editTitle(item: TopicsItem): Promise<void> {
    try {
      const fileName = item.topic;
      if (!fileName) {
        vscode.window.showErrorMessage('Failed to get topic by title');
        return;
      }
      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new topic name',
        value: item.label as string,
      });
      if (!newName) {
        vscode.window.showWarningMessage('Edit title canceled.');
        return;
      }

      let enteredFileName = await vscode.window.showInputBox({
        prompt: 'Enter a new file name or skip',
        value: item.topic,
      });

      if (!enteredFileName) {
        vscode.window.showWarningMessage('Edit title canceled.');
        return;
      }
      if (enteredFileName === item.topic) {
        await this.renameTopic(item.topic, newName);
        return;
      }

      let counter = 1;
      while (await this.topicsService.topicExists(enteredFileName)) {
        vscode.window.showWarningMessage(`A topic file with filename "${enteredFileName}" already exists.`);
        enteredFileName = await vscode.window.showInputBox({
          prompt: 'Enter different file name',
          value: `${newName.toLowerCase().replace(/\s+/g, '-')}${counter}.md`,
        });
        if (!enteredFileName) {
          vscode.window.showWarningMessage('Edit title canceled.');
          return;
        }
        if (enteredFileName === item.topic) {
          await this.renameTopic(item.topic, newName);
          return;
        }
        counter += 1;
      }

      await this.renameTopic(item.topic, newName, enteredFileName);

    }
    catch {
      vscode.window.showWarningMessage('Failed to edit title.');
    }

  }

  public async deleteTopic(item: TopicsItem): Promise<void> {
    if (!this.currentDocId || !item.topic) {
      vscode.window.showWarningMessage('No topic selected or invalid document state.');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete topic "${item.label}"?`,
      { modal: true },
      'Yes'
    );
    if (confirm !== 'Yes') return;

    const success = await this.topicsService.deleteTopic(this.currentDocId, item.topic);
    if (!success) {
      vscode.window.showWarningMessage(`Failed to delete topic "${item.label}".`);
      return;
    }
    this.topicsService.removeTopicFromTree(item.topic, this.tocTree);
    this.refresh();
  }

  private static async createTopic(): Promise<TocElement | undefined> {
    const topicTitle = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
    if (!topicTitle) {
      vscode.window.showWarningMessage('Topic creation canceled.');
      return undefined;
    }

    const defaultFileName = TopicsService.formatTitleAsFilename(topicTitle);
    const enteredFileName = await vscode.window.showInputBox({
      prompt: 'Enter file name',
      value: defaultFileName,
    });
    if (!enteredFileName) {
      vscode.window.showWarningMessage('Topic creation canceled.');
      return undefined;
    }

    return {
      topic: enteredFileName,
      title: topicTitle,
      children: [],
    };
  }

  public async renameTopic(oldTopic: string, newName: string, enteredFileName?: string): Promise<void> {
    try {
      if (!this.currentDocId || !oldTopic) {
        vscode.window.showWarningMessage('Rename failed, invalid document state.');
        return;
      }

      this.topicsService.renameTopic(this.currentDocId, oldTopic, newName, this.tocTree, enteredFileName);
      this.onDidChangeTreeDataEmitter.fire();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to rename topic: ${error.message}`);
    }
  }

  public findTopicItemByFilename(fileName: string): TocElement | undefined {
    return this.topicsService.findTopicItemByFilename(fileName, this.tocTree);
  }

  public async setAsStartPage(topic: string): Promise<boolean> {
    if (!this.currentDocId) {
      vscode.window.showWarningMessage("Documentation not selected");
      return false
    };
    return this.topicsService.setAsStartPage(this.currentDocId, topic);
  }
}
