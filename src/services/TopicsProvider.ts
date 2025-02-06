/* eslint-disable class-methods-use-this */
/* eslint-disable no-param-reassign */
/* eslint-disable import/no-unresolved */
import * as vscode from 'vscode';
import { TocElement } from '../utils/types';
import TopicsItem from './TopicsItem';
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
    if (tocTree) this.tocTree = tocTree;
    if (docId) this.currentDocId = docId;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: TopicsItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: TopicsItem): Promise<TopicsItem[]> {
    return element 
      ? element.children.map(child => this.topicsService.createTreeItem(child))
      : this.tocTree.map(item => this.topicsService.createTreeItem(item));
  }

  public async moveTopic(sourceTopicId: string, targetTopicId: string): Promise<void> {
    if (!this.currentDocId) return;

    try {
      const newTocTree = await this.topicsService.moveTopic(
        this.currentDocId,
        sourceTopicId,
        targetTopicId
      );
      if (newTocTree.length > 0) this.refresh(newTocTree);
    } catch (error) {
      TopicsProvider.showError(error, 'Failed to move topic');
    }
  }

  public async addRootTopic(): Promise<void> {
    if (!this.currentDocId) {
      vscode.window.showWarningMessage('No active document to add a topic to.');
      return;
    }

    try {
      const topicTitle = await vscode.window.showInputBox({ 
        prompt: 'Enter Topic Title' 
      });
      if (!topicTitle) return;

      const defaultFileName = TopicsService.formatTitleAsFilename(topicTitle);
      const enteredFileName = await this.promptForFileName(defaultFileName); 
      if (!enteredFileName) return;
      const newTopic = await this.topicsService.addChildTopic(
        this.currentDocId,
        null,
        topicTitle,
        enteredFileName
      );
      
      if (newTopic) this.onDidChangeTreeDataEmitter.fire();
    } catch (error) {
      TopicsProvider.showError(error, 'Failed to add root topic');
    }
  }

  public async addChildTopic(parent?: TopicsItem): Promise<void> {
    if (!parent) {
      vscode.window.showErrorMessage("Failed to add child topic, parent doesn't exist");
      return;
    }

    try {
      const topicTitle = await vscode.window.showInputBox({ 
        prompt: 'Enter Child Topic Title' 
      });
      if (!topicTitle) return;

      const defaultFileName = TopicsService.formatTitleAsFilename(topicTitle);
      const enteredFileName = await this.promptForFileName(defaultFileName);
      if (!enteredFileName) return;

      const newTopic = await this.topicsService.addChildTopic(
        this.currentDocId!,
        parent.topic,
        topicTitle,
        enteredFileName
      );

      if (newTopic) {
        parent.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        parent.children.push(newTopic);
        this.onDidChangeTreeDataEmitter.fire();
      }
    } catch (error) {
      TopicsProvider.showError(error, 'Failed to add child topic');
    }
  }

  public async addSiblingTopic(sibling?: TopicsItem): Promise<void> {
    if (!sibling) {
      vscode.window.showErrorMessage('Invalid sibling/topic');
      return;
    }

    try {
      const parent = this.topicsService.getParentByTopic(this.tocTree, sibling.topic);
      if (parent === true) await this.addRootTopic();
      else if (parent) {
        const parentItem = this.topicsService.createTreeItem(parent);
        await this.addChildTopic(parentItem);
      }
    } catch (error) {
      TopicsProvider.showError(error, 'Failed to add sibling topic');
    }
  }

  public async editTopicTitle(item: TopicsItem): Promise<void> {
    if (!item.topic) {
      vscode.window.showErrorMessage('Failed to get topic by title');
      return;
    }

    try {
      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new topic name',
        value: item.label as string,
      });
      if (!newName) return;

      const enteredFileName = await vscode.window.showInputBox({
        prompt: 'Enter new file name or skip',
        value: item.topic,
      });
      if (!enteredFileName) return;

      await this.topicsService.updateMarkdownTitle(item.topic, newName);
      await this.handleFileNameConflict(item, newName, enteredFileName);
    } catch (error) {
      TopicsProvider.showError(error, 'Failed to edit title');
    }
  }

  public async deleteTopic(item: TopicsItem): Promise<void> {
    if (!this.currentDocId || !item.topic) {
      vscode.window.showWarningMessage('No topic selected or invalid document state.');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete topic "${item.label}"?`, { modal: true }, 'Yes'
    );
    if (confirm !== 'Yes') return;

    try {
      const success = await this.topicsService.deleteTopic(this.currentDocId, item.topic);
      if (success) {
        this.topicsService.removeTopicFromTree(item.topic, this.tocTree);
        this.refresh();
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('start page')) {
        vscode.window.showWarningMessage(error.message);
      } else {
        TopicsProvider.showError(error, `Failed to delete topic "${item.label}"`);
      }
    }
  }

  public async setAsStartPage(topic: string): Promise<void> {
    if (!this.currentDocId) {
      vscode.window.showWarningMessage("Documentation not selected");
      return;
    }

    try {
      const success = await this.topicsService.setAsStartPage(this.currentDocId, topic);
      if (success) {
        vscode.window.showInformationMessage(`"${topic}" set as start page`);
      }
    } catch (error) {
      TopicsProvider.showError(error, 'Failed to set start page');
    }
  }

  private async handleFileNameConflict(item: TopicsItem, newName: string, enteredFileName: string) {
    if (enteredFileName === item.topic) {
      await this.renameTopic(item.topic, newName);
      return;
    }

    let counter = 1;
    while (await this.topicsService.topicExists(enteredFileName)) {
      vscode.window.showWarningMessage(`File "${enteredFileName}" exists.`);
      const newFileName = await vscode.window.showInputBox({
        prompt: 'Enter different file name',
        value: `${newName.toLowerCase().replace(/\s+/g, '-')}${counter}.md`,
      });
      if (!newFileName) return;
      enteredFileName = newFileName;
      counter += 1;
    }
    await this.renameTopic(item.topic, newName, enteredFileName);
  }

  private async promptForFileName(defaultName: string): Promise<string | undefined> {
    let enteredFileName = await vscode.window.showInputBox({
      prompt: 'Enter file name',
      value: defaultName,
    });

    if (!enteredFileName) {
      vscode.window.showWarningMessage('Topic creation canceled.');
      return undefined;
    }

    if (await this.topicsService.topicExists(enteredFileName)) {
      vscode.window.showWarningMessage(`File "${enteredFileName}" already exists.`);
      return this.promptForFileName(defaultName);
    }
    if(enteredFileName !== defaultName || !enteredFileName.endsWith('.md')){
      enteredFileName = TopicsService.formatTitleAsFilename(enteredFileName);
    }
    return enteredFileName;
  }

  private static showError(error: unknown, defaultMsg: string) {
    const message = error instanceof Error ? error.message : defaultMsg;
    vscode.window.showErrorMessage(message);
  }

  // Existing helper methods remain the same
  public findTopicItemByFilename(fileName: string): TocElement | undefined {
    return this.topicsService.findTopicItemByFilename(fileName, this.tocTree);
  }

  public async renameTopic(oldTopic: string, newName: string, enteredFileName?: string): Promise<void> {
    if (!this.currentDocId) return;

    try {
      await this.topicsService.renameTopic(
        this.currentDocId,
        oldTopic,
        newName,
        this.tocTree,
        enteredFileName
      );
      this.onDidChangeTreeDataEmitter.fire();
    } catch (error) {
      TopicsProvider.showError(error, 'Failed to rename topic');
    }
  }
}