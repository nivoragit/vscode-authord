/* eslint-disable import/no-unresolved */
import * as vscode from 'vscode';
import { TocElement } from '../utils/types';
import TopicsItem from './topicsItem';
import TopicsService from './TopicsService';

export default class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private onDidChangeTreeDataEmitter = new vscode.EventEmitter<TopicsItem | undefined | void>();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public readonly topicsService: TopicsService;

  private tocTree: TocElement[] = [];

  public currentDocId: string | undefined;

  constructor(topicsService: TopicsService) {
    this.topicsService = topicsService;
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

  // eslint-disable-next-line class-methods-use-this
  public getTreeItem(element: TopicsItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: TopicsItem): Promise<TopicsItem[]> {
    if (!element) {
      return this.tocTree.map((item) => this.topicsService.createTreeItem(item));
    }
    return element.children.map((child) => this.topicsService.createTreeItem(child));
  }

  public async moveTopic(sourceTopicId: string, targetTopicId: string): Promise<void> {
    if (!this.currentDocId) return;

    const newTocTree = await this.topicsService.moveTopic(
      this.currentDocId,
      sourceTopicId,
      targetTopicId
    );
    if (newTocTree.length === 0) {
      return;
    }
    this.refresh(newTocTree);
  }

  public async addRootTopic(): Promise<void> {
    if (!this.currentDocId) {
      vscode.window.showWarningMessage('No active document to add a topic to.');
      return;
    }

    const newTopic = await this.topicsService.addChildTopic(this.currentDocId, null);
    if (!newTopic) {
      vscode.window.showWarningMessage('Failed to add root topic.');
      return;
    }
    this.tocTree.push(newTopic);
    this.onDidChangeTreeDataEmitter.fire();
  }

  public async addChildTopic(parent?: TopicsItem): Promise<void> {
    if (!parent) {
      vscode.window.showErrorMessage("Failed to add child topic, parent doesn't exists");
      return;
    }

    if (!this.currentDocId) {
      vscode.window.showErrorMessage('No active document to add a topic to.');
      return;
    }
    const newTopic = await this.topicsService.addChildTopic(this.currentDocId, parent?.topic || null);
    if (!newTopic) {
      vscode.window.showErrorMessage("Failed to add child topic, newTopic doesn't exists");
      return;
    }
    // eslint-disable-next-line no-param-reassign
    parent.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    // eslint-disable-next-line no-param-reassign
    parent.children.push(newTopic);
    this.onDidChangeTreeDataEmitter.fire();
  }

  public async addSiblingTopic(sibling?: TopicsItem): Promise<void> {
    if (!this.currentDocId) {
      vscode.window.showErrorMessage('No active document to add a topic to.');
      return;
    }
    if (!sibling) {
      vscode.window.showErrorMessage('Invalid sibling/topic');
      return;
    }
    try {
      const parent = this.topicsService.getParentByTopic(this.tocTree, sibling.topic);
      if (parent === true) {
        await this.addRootTopic();
      } else if (parent) {
        const parentItem = this.topicsService.createTreeItem(parent);
        await this.addChildTopic(parentItem);
      } else {
        vscode.window.showWarningMessage('Failed to add sibling topic.');
      }
    } catch {
      vscode.window.showWarningMessage('Failed to add sibling topic.');
    }
    this.onDidChangeTreeDataEmitter.fire();
  }

  public async editTopicTitle(item: TopicsItem): Promise<void> {
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
        // rename without changing file name
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
      // rename with changing file name
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
