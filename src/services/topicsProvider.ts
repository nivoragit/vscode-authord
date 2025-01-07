import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs'; // Updated to use fs.promises for async operations
import { AbstractConfigManager, TocElement } from '../configurationManagers/abstractConfigurationManager';
import { DocumentationItem } from './documentationProvider';

export class TopicsProvider implements vscode.TreeDataProvider<TopicsItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TopicsItem | undefined | void> = new vscode.EventEmitter<TopicsItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicsItem | undefined | void> = this._onDidChangeTreeData.event;
  private tocTree: TocElement[] = [];
  private configManager: AbstractConfigManager;
  currentDocId: string | undefined;

  constructor(configManager: AbstractConfigManager) {
    this.configManager = configManager;
  }

  refresh(tocTree: TocElement[] | null, docId: string | null): void {
    if (tocTree) {
      this.tocTree = tocTree;
    }
    if (docId) {
      this.currentDocId = docId;
    }

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

  private createTreeItem(item: TocElement): TopicsItem {
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

  async moveTopic(sourceTopicId: string, targetTopicId: string): Promise<void> {
    const newTocTree = await this.configManager?.moveTopics(
      this.currentDocId as string,
      sourceTopicId,
      targetTopicId
    );

    if (!newTocTree) {
      return; // Target not found
    }
    this.refresh(newTocTree, null);
  }

  private formatTitleAsFilename(title: string): string {
    return title.trim().toLowerCase().replace(/\s+/g, '-') + '.md';
  }

  async rootTopic(element: DocumentationItem): Promise<void> {
    try {
      if (element && !this.currentDocId) {
        this.currentDocId = element.id;
      }
      const newTopic = await this.createTopic();
      if(!newTopic){ return; }
      // Attempt to add to config (returns Promise<boolean>)
      const success = await this.configManager.addChildTopic(this.currentDocId as string, null, newTopic);
      if (!success) {
        vscode.window.showWarningMessage('Failed to add root topic via config manager.');
        return;
      }

      // Update local tocTree
      this.tocTree.push(newTopic);
      this._onDidChangeTreeData.fire();
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create root topic: ${error.message}`);
    }
  }

  private async topicExists(enteredFileName: string): Promise<boolean> {
    const docDir = this.configManager.getTopicsDir();
    const topicPath = path.join(docDir, enteredFileName);

    // Check if the file already exists
    try {
      await fs.access(topicPath);
      vscode.window.showInformationMessage(`File "${enteredFileName}" already exists. Please choose a different file name.`);
      return true;
    } catch {
      // If fs.access throws, the file does not exist
      return false;
    }
  }

  // This is the most efficient approach for prompting the title first, then letting the user edit the default file name.
  async addChildTopic(parent?: TopicsItem): Promise<void> {
    const newTopic = await this.createTopic();
    if (!newTopic || !this.currentDocId) { return; }
    // Add to either the parent or root
    if (parent) {
      parent.children.push(newTopic);
    } else {
      this.tocTree.push(newTopic);
    }
    // Attempt to add to config (returns Promise<boolean>)
    const success = await this.configManager.addChildTopic(
      this.currentDocId,
      parent?.label as string || null,
      newTopic
    );
    if (!success) {
      vscode.window.showWarningMessage('Failed to add topic via config manager.');
      return;
    }

    this._onDidChangeTreeData.fire();
  }

  private findSiblingsByLabel(topics: TocElement[], label: string): TocElement[] | undefined {
    for (const t of topics) {
      if (t.title === label) {
        return topics;
      }
      const found = this.findSiblingsByLabel(t.children, label);
      if (found) { return found; }
    }
    return undefined;
  }

  async addSiblingTopic(sibling?: TopicsItem): Promise<void> {
    const newTopic = await this.createTopic();
    if (!newTopic || !this.currentDocId || !sibling) { return; }
    const tree = this.findSiblingsByLabel(this.tocTree, sibling.label as string);
    tree?.push(newTopic);

    // Attempt to add to config (returns Promise<boolean>)
    const success = await this.configManager.addSiblingTopic(
      this.currentDocId,
      sibling.label as string,
      newTopic
    );
    if (!success) {
      vscode.window.showWarningMessage('Failed to add topic via config manager.');
      return;
    }
    this._onDidChangeTreeData.fire();
  }

  async setStartPage(instance?: TopicsItem): Promise<void> {
    if (!this.currentDocId || !instance) { return; }

    // Attempt to add to config (returns Promise<boolean>)
    const success = await this.configManager.SetasStartPage(
      this.currentDocId,
      instance.label as string,
    );
    if (!success) {
      vscode.window.showWarningMessage('Failed to add topic via config manager.');
      return;
    }
    this._onDidChangeTreeData.fire();
  }

  async createTopic(): Promise<TocElement | undefined> {
    try {
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
      const defaultFileName = this.formatTitleAsFilename(topicTitle);

      // Prompt the user for the file name, pre-populated with the default
      let enteredFileName = await vscode.window.showInputBox({
        prompt: 'Enter file name',
        value: defaultFileName
      });
      if (!enteredFileName) {
        vscode.window.showWarningMessage('Topic creation canceled.');
        return;
      }

      let counter = 1;
      while (await this.topicExists(enteredFileName)) {
        vscode.window.showWarningMessage(`A topic with filename "${enteredFileName}" already exists.`);
        // Prompt the user for a different file name
        enteredFileName = await vscode.window.showInputBox({
          prompt: 'Enter different file name',
          value: `${topicTitle.toLowerCase().replace(/\s+/g, '-')}${counter}.md`
        });
        if (!enteredFileName) {
          vscode.window.showWarningMessage('Topic creation canceled.');
          return;
        }
        counter++;
      }

      // Create the new topic
      return {
        topic: enteredFileName,
        title: topicTitle,
        sortChildren: "none",
        children: []
      };
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to add a new topic: ${error.message}`);
      return;
    }
  }

  async deleteTopic(item: TopicsItem): Promise<void> {
    try {
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

      // Attempt to delete from config (returns Promise<boolean>)
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

  async renameTopic(topic: string, newName: string): Promise<void> {
    try {
      if (!this.currentDocId || !topic) {
        vscode.window.showWarningMessage('Rename failed, invalid document state.');
        return;
      }

      // Attempt to rename in config (returns Promise<boolean>)
      const renameSuccess = await this.configManager.renameTopic(this.currentDocId, topic, newName);
      if (!renameSuccess) {
        vscode.window.showWarningMessage('Failed to rename topic via config manager.');
        return;
      }

      this.renameTopicInTree(topic, newName, this.tocTree);
      this.refresh(this.tocTree, this.currentDocId);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to rename topic: ${error.message}`);
    }
  }

  private removeTopicFromTree(topicId: string, tree: TocElement[]): boolean {
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

  findTopicItemByFilename(fileName: string, tocTree?: TocElement[]): TocElement | undefined {
    if (!tocTree) {
      tocTree = this.tocTree;
    }
    for (const item of tocTree) {
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

  private renameTopicInTree(topicId: string, newName: string, tree: TocElement[]): void {
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].topic === topicId) {
        tree[i].topic = newName.toLowerCase().replace(/\s+/g, '-') + '.md';
        return; // Exit once the topic is updated
      }
      if (tree[i].children && tree[i].children.length > 0) {
        this.renameTopicInTree(topicId, newName, tree[i].children);
        return; // Exit after the recursive call if the topic is found
      }
    }
  }
}

export class TopicsItem extends vscode.TreeItem {
  children: TocElement[];
  topic: string;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    children: TocElement[] = [],
    topic: string
  ) {
    super(label, collapsibleState);
    this.children = children;
    this.contextValue = 'topic';
    this.topic = topic;
  }
}
