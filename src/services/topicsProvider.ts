// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import AbstractConfigManager from '../configurationManagers/abstractConfigurationManager';
import { TocElement } from '../utils/types';
import TopicsItem from './topicsItem';
import DocumentationItem from './documentationItem';

export default class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private onDidChangeTreeDataEmitter: vscode.EventEmitter<TopicsItem | undefined | void> =
    new vscode.EventEmitter<TopicsItem | undefined | void>();

  public readonly onDidChangeTreeData: vscode.Event<TopicsItem | undefined | void> =
    this.onDidChangeTreeDataEmitter.event;

  private tocTree: TocElement[] = [];

  private configManager: AbstractConfigManager;

  public currentDocId: string | undefined;

  constructor(configManager: AbstractConfigManager) {
    this.configManager = configManager;
  }

  public refresh(tocTree: TocElement[] | null, docId: string | null): void {
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

  public getChildren(element?: TopicsItem): Thenable<TopicsItem[]> {
    if (!element) {
      return Promise.resolve(this.tocTree.map((item) => this.createTreeItem(item)));
    }
    return Promise.resolve(element.children.map((child) => this.createTreeItem(child)));
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
      arguments: [path.join(this.configManager.getTopicsDir(), item.topic)],
    };
    return treeItem;
  }

  public async moveTopic(sourceTopicId: string, targetTopicId: string): Promise<void> {
    const newTocTree = await this.configManager?.moveTopics(
      this.currentDocId as string,
      sourceTopicId,
      targetTopicId,
    );

    if (newTocTree.length === 0) {
      return; // Target not found
    }

    this.refresh(newTocTree, null);
  }

  // Converted to a static method to avoid the "class-methods-use-this" issue.
  public static formatTitleAsFilename(title: string): string {
    return `${title.trim().toLowerCase().replace(/\s+/g, '-')}.md`;
  }

  public async addRootTopic(element: DocumentationItem): Promise<void> {
    try {
      if (element && !this.currentDocId) {
        this.currentDocId = element.id;
      }

      const newTopic = await this.createTopic();
      if (!newTopic) return;

      const success = await this.configManager.addChildTopic(
        this.currentDocId as string,
        null,
        newTopic,
      );
      if (!success) {
        vscode.window.showWarningMessage('Failed to add root topic via config manager.');
        return;
      }

      this.onDidChangeTreeDataEmitter.fire();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create root topic: ${error.message}`);
    }
  }

  private async topicExists(enteredFileName: string): Promise<boolean> {
    const docDir = this.configManager.getTopicsDir();
    const topicPath = path.join(docDir, enteredFileName);
    try {
      await fs.access(topicPath);
      vscode.window.showInformationMessage(`File "${enteredFileName}" already exists. Please choose a different file name.`);
      return true;
    } catch {
      return false;
    }
  }

  // This is the most efficient approach for prompting the title first, then letting the user edit the default file name.
  public async addChildTopic(parent?: TopicsItem): Promise<void> {
    const newTopic = await this.createTopic();
    if (!newTopic || !this.currentDocId) return;

    if (parent) {
      parent.children.push(newTopic);      
      // eslint-disable-next-line no-param-reassign
      parent.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    } else {
      this.tocTree.push(newTopic);
    }

    const success = await this.configManager.addChildTopic(
      this.currentDocId,
      parent?.topic || null,
      newTopic,
    );
    if (!success) {
      vscode.window.showWarningMessage('Failed to add topic via config manager.');
      return;
    }

    this.onDidChangeTreeDataEmitter.fire();
  }

  private findSiblingsByTopic(topics: TocElement[], topic: string): TocElement[] | undefined {
    for (let i = 0; i < topics.length; i += 1) {
      if (topics[i].topic === topic) {
        return topics;
      }
      const found = this.findSiblingsByTopic(topics[i].children, topic);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  public async addSiblingTopic(sibling?: TopicsItem): Promise<void> {
    const newTopic = await this.createTopic();
    if (!newTopic || !this.currentDocId || !sibling) return;

    const tree = this.findSiblingsByTopic(this.tocTree, sibling.topic);
    if (tree) {
      tree.push(newTopic);
    }

    const success = await this.configManager.addSiblingTopic(
      this.currentDocId,
      sibling.topic,
      newTopic,
    );
    if (!success) {
      vscode.window.showWarningMessage('Failed to add topic via config manager.');
      return;
    }

    this.onDidChangeTreeDataEmitter.fire();
  }

  public async setStartPage(instance?: TopicsItem): Promise<void> {
    if (!this.currentDocId || !instance) return;

    const success = await this.configManager.SetasStartPage(
      this.currentDocId,
      instance.topic,
    );
    if (!success) {
      vscode.window.showWarningMessage('Failed to add topic via config manager.');
      return;
    }

    this.onDidChangeTreeDataEmitter.fire();
  }

  public async createTopic(): Promise<TocElement | undefined> {
    try {
      if (!this.currentDocId) {
        vscode.window.showWarningMessage('No active document to add a topic to.');
        return undefined;
      }

      const topicTitle = await vscode.window.showInputBox({ prompt: 'Enter Topic Title' });
      if (!topicTitle) {
        vscode.window.showWarningMessage('Topic creation canceled.');
        return undefined;
      }

      const defaultFileName = TopicsProvider.formatTitleAsFilename(topicTitle);
      let enteredFileName = await vscode.window.showInputBox({
        prompt: 'Enter file name',
        value: defaultFileName,
      });

      if (!enteredFileName) {
        vscode.window.showWarningMessage('Topic creation canceled.');
        return undefined;
      }

      let counter = 1;
      while (await this.topicExists(enteredFileName)) {
        vscode.window.showWarningMessage(`A topic with filename "${enteredFileName}" already exists.`);
        enteredFileName = await vscode.window.showInputBox({
          prompt: 'Enter different file name',
          value: `${topicTitle.toLowerCase().replace(/\s+/g, '-')}${counter}.md`,
        });
        if (!enteredFileName) {
          vscode.window.showWarningMessage('Topic creation canceled.');
          return undefined;
        }
        counter += 1;
      }

      return {
        topic: enteredFileName,
        title: topicTitle,
        children: [],
      };
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to add a new topic: ${error.message}`);
      return undefined;
    }
  }

  public async deleteTopic(item: TopicsItem): Promise<void> {
    try {
      if (!this.currentDocId || !item.topic) {
        vscode.window.showWarningMessage('No topic selected or invalid document state.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete topic "${item.label}"?`,
        { modal: true },
        'Yes',
      );
      if (confirm !== 'Yes') {
        return;
      }

      const success = await this.configManager.deleteTopic(this.currentDocId, item.topic);
      if (!success) {
        vscode.window.showWarningMessage(`Failed to delete topic "${item.label}" via config manager.`);
        return;
      }

      this.removeTopicFromTree(item.topic, this.tocTree);
      this.refresh(this.tocTree, this.currentDocId);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to delete topic: ${error.message}`);
    }
  }

  public async renameTopicCommand(item: TopicsItem): Promise<void> {
    try {
      if (!this.currentDocId) {
        vscode.window.showWarningMessage('No active document to rename a topic in.');
        return;
      }

      if (!item || !item.topic) {
        vscode.window.showWarningMessage('Invalid topic selected for rename.');
        return;
      }

      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new topic name',
        value: item.label as string,
      });
      if (!newName) {
        vscode.window.showWarningMessage('Rename canceled.');
        return;
      }

      let enteredFileName = await vscode.window.showInputBox({
        prompt: 'Enter a new file name or skip',
        value: item.topic,
      });

      let counter = 1;
      while (
        enteredFileName !== item.topic &&
        enteredFileName &&
        (await this.topicExists(enteredFileName))
      ) {
        vscode.window.showWarningMessage(`A topic file with filename "${enteredFileName}" already exists.`);
        enteredFileName = await vscode.window.showInputBox({
          prompt: 'Enter different file name',
          value: `${newName.toLowerCase().replace(/\s+/g, '-')}${counter}.md`,
        });
        if (!enteredFileName) {
          break;
        }
        counter += 1;
      }

      const fileName = item.topic;
      if (!fileName) {
        vscode.window.showErrorMessage('Failed to get topic by title');
        return;
      }

      if (enteredFileName !== item.topic && enteredFileName) {
        const correctedFileName = enteredFileName.endsWith('.md')
          ? enteredFileName
          : `${enteredFileName}.md`;

        await this.renameTopic(item.topic, newName, correctedFileName);
        if (item.label as string !== newName) {
          this.configManager.setMarkdownTitle(correctedFileName, newName);
        }
      } else if ((item.label as string) !== newName) {
        await this.renameTopic(item.topic, newName);
        this.configManager.setMarkdownTitle(fileName, newName);
      } else {
        return;
      }

      vscode.window.showInformationMessage('Topic renamed successfully.');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to rename topic: ${error.message}`);
    }
  }

  public async renameTopic(topic: string, newName: string, enteredFileName?: string): Promise<void> {
    try {
      if (!this.currentDocId || !topic) {
        vscode.window.showWarningMessage('Rename failed, invalid document state.');
        return;
      }

      if (enteredFileName) {
        const renameSuccess = await this.configManager.renameTopic(
          this.currentDocId,
          topic,
          newName,
          enteredFileName,
        );
        if (!renameSuccess) {
          vscode.window.showWarningMessage('Failed to rename topic via config manager.');
          return;
        }

        await vscode.commands.executeCommand('workbench.action.closeEditorsToTheRight');
        this.renameTopicInTree(topic, newName, this.tocTree, enteredFileName);
      } else {
        this.renameTopicInTree(topic, newName, this.tocTree);
      }

      this.onDidChangeTreeDataEmitter.fire();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to rename topic: ${error.message}`);
    }
  }

  private removeTopicFromTree(topicId: string, tree: TocElement[]): boolean {
    for (let i = 0; i < tree.length; i += 1) {
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

  public findTopicItemByFilename(fileName: string, tocTree?: TocElement[]): TocElement | undefined {
    const searchTree = tocTree || this.tocTree;

    for (let i = 0; i < searchTree.length; i += 1) {
      const item = searchTree[i];
      if (item.topic === fileName) {
        return item;
      }
      if (item.children && item.children.length > 0) {
        const found = this.findTopicItemByFilename(fileName, item.children);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  private renameTopicInTree(
    topicId: string,
    newName: string,
    tree: TocElement[],
    newTopic?: string,
  ): void {
    for (let i = 0; i < tree.length; i += 1) {
      if (tree[i].topic === topicId) {
        // eslint-disable-next-line no-param-reassign
        tree[i].title = newName;
        if (newTopic) {
          // eslint-disable-next-line no-param-reassign
          tree[i].topic = newTopic;
        }
        return;
      }
      if (tree[i].children && tree[i].children.length > 0) {
        this.renameTopicInTree(topicId, newName, tree[i].children, newTopic);
        return;
      }
    }
  }
}
