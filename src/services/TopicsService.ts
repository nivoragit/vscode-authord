/* eslint-disable no-param-reassign */
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { InstanceConfig, TocElement } from "../utils/types";
import TopicsItem from './TopicsItem';
import { IBaseFileManager } from '../managers/IFileManager';

export default class TopicsService {
  readonly topicDir: string;

  constructor(
    private readonly configManager: IBaseFileManager
  ) {
    this.topicDir = this.configManager.getTopicsDirectory();
  }

  public async moveTopic(
    docId: string,
    sourceTopicId: string,
    targetTopicId: string
  ): Promise<TocElement[]> {
    if (sourceTopicId === targetTopicId) {
      return [];
    }
    const doc = this.configManager.instances.find((d: InstanceConfig) => d.id === docId);
    if (!doc) {
      throw new Error(`Document "${docId}" not found for moveTopicInDoc.`);
    }

    const targetTopic = await this.findTopicInTocElements(
      doc['toc-elements'],
      targetTopicId,
      sourceTopicId
    );
    if (!targetTopic) {
      return [];
    }

    if (!(targetTopic as TocElement).children) {
      (targetTopic as TocElement).children = [];
    }

    const sourceTopic = await this.removeTopicFromDoc(
      doc['toc-elements'],
      sourceTopicId
    );
    if (!sourceTopic) {
      return [];
    }

    (targetTopic as TocElement).children.push(sourceTopic);
    this.configManager.saveDocumentConfig(doc);
    return doc['toc-elements'];
  }

  public async deleteTopic(docId: string, topicFileName: string): Promise<boolean> {
    const doc = this.configManager.instances.find((d: InstanceConfig) => d.id === docId);
    if (!doc) {
      vscode.window.showErrorMessage(`Document "${docId}" not found.`);
      return false;
    }
    if (doc['start-page'] === topicFileName) {
      await vscode.window.showWarningMessage(
        "Home page can't be deleted",
        { modal: true }
      );
      return false;
    }
    const removedTopic = this.removeTopicByFilename(
      doc['toc-elements'],
      topicFileName
    );
    if (!removedTopic) {
      vscode.window.showErrorMessage(
        `Topic "${topicFileName}" not found in document "${docId}".`
      );
      return false;
    }
    const topicsFilestoBeRemoved = TopicsService.getAllTopicsFromTocElement([removedTopic]);
    try {
      this.configManager.removeTopicFiles(topicsFilestoBeRemoved, doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete topics: ${err.message}`);
      return false;
    }
  }

  public async addChildTopic(
    docId: string,
    parentTopic: string | null
  ): Promise<TocElement | null> {
    const newTopic = await TopicsService.createTopic();
    if (docId && newTopic) {
      try {
        const doc = this.configManager.instances.find((d: InstanceConfig) => d.id === docId);
        if (!doc) {
          vscode.window.showErrorMessage(`Document "${docId}" not found.`);
          throw new Error('child topic creation failed');
        }
        let parentArray: TocElement[];
        if (parentTopic) {
          const parent = this.findTopicByFilename(doc['toc-elements'], parentTopic);
          if (!parent) {
            vscode.window.showErrorMessage(
              `Parent topic "${parentTopic}" not found.`
            );
            throw new Error('child topic creation failed');
          }
          parentArray = parent.children;
        } else {
          parentArray = doc['toc-elements'];
          parentArray.push(newTopic);
        }
        this.configManager.createChildTopicFile(newTopic, doc);
        return newTopic;
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Failed to add topic "${newTopic.title}": ${err.message}`
        );
        return null;
      }
    }
    return null;
  }

  public async renameTopic(
    docId: string,
    oldTopicFile: string,
    newName: string,
    tree: TocElement[],
    newTopicFilename?: string
  ): Promise<boolean> {
    try {
      if (newTopicFilename) {
        const doc = this.configManager.instances.find((d: InstanceConfig) => d.id === docId);
        if (!doc) {
          vscode.window.showErrorMessage(`Document "${docId}" not found for renameTopic.`);
          return false;
        }

        const topic = this.findTopicByFilename(doc['toc-elements'], oldTopicFile);
        if (!topic) {
          vscode.window.showErrorMessage(
            `Topic "${oldTopicFile}" not found in doc "${docId}".`
          );
          return false;
        }
        const newTopicFile = newTopicFilename || TopicsService.formatTitleAsFilename(newName);

        if (doc['toc-elements'].length === 1) {
          doc['start-page'] = newTopicFile;
        }

        topic.topic = newTopicFile;
        topic.title = newName;
        const renameSuccess = this.configManager.renameTopicFile(oldTopicFile, newTopicFile, doc);

        if (!renameSuccess) {
          vscode.window.showWarningMessage('Failed to rename topic via config manager.');
          return false;
        }

        await vscode.commands.executeCommand('workbench.action.closeEditorsToTheRight');
        return this.renameTopicInTree(oldTopicFile, newName, tree, newTopicFilename);
      }

      return this.renameTopicInTree(oldTopicFile, newName, tree);
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to rename topic "${oldTopicFile}" to "${newName}": ${err.message}`
      );
      return false;
    }
  }

  public async setAsStartPage(docId: string, topic: string): Promise<boolean> {
    try {
      const doc = this.configManager.instances.find((d: InstanceConfig) => d.id === docId);
      if (!doc) {
        vscode.window.showWarningMessage(`Document "${docId}" not found.`);
        return false;
      }
      doc['start-page'] = topic;
      await this.configManager.saveDocumentConfig(doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set start page:${err}`);
      return false;
    }
  }

  public async updateMarkdownTitle(topicFile: string, newTitle: string): Promise<void> {
    await this.configManager.updateMarkdownTitle(topicFile, newTitle);
  }

  private static formatTitleAsFilename(title: string): string {
    return `${title.trim().toLowerCase().replace(/\s+/g, '-')}.md`;
  }

  public findTopicItemByFilename(fileName: string, searchTree: TocElement[]): TocElement | undefined {
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

  public getParentByTopic(topics: TocElement[], topic: string): TocElement | boolean {
    for (let i = 0; i < topics.length; i += 1) {
      const t = topics[i];
      if (t.topic === topic) {
        return true;
      }
      if (t.children?.length) {
        const found = this.getParentByTopic(t.children, topic);
        if (found) return t;
      }
    }
    return false;
  }

  public removeTopicFromTree(topicId: string, tree: TocElement[]): boolean {
    for (let i = 0; i < tree.length; i += 1) {
      if (tree[i].topic === topicId) {
        tree.splice(i, 1);
        return true;
      }
      if (tree[i].children?.length) {
        const found = this.removeTopicFromTree(topicId, tree[i].children);
        if (found) return true;
      }
    }
    return false;
  }

  public renameTopicInTree(
    topicId: string,
    newName: string,
    tree: TocElement[],
    newTopic?: string,
  ): boolean {
    for (let i = 0; i < tree.length; i += 1) {
      if (tree[i].topic === topicId) {
        tree[i].title = newName; // Rename the title
        if (newTopic) {
          tree[i].topic = newTopic; // Update the topic ID if provided
        }
        return true; // Indicate successful rename
      }
      if (tree[i].children && tree[i].children.length > 0) {
        // Recursively check in the children
        const renamed = this.renameTopicInTree(topicId, newName, tree[i].children, newTopic);
        if (renamed) {
          return true; // If renamed in children, return true
        }
      }
    }
    return false; // Return false if no match is found in the tree
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

  public createTreeItem(item: TocElement): TopicsItem {
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
      arguments: [path.join(this.topicDir, item.topic)],
    };

    return treeItem;
  }

  public async topicExists(enteredFileName: string): Promise<boolean> {
    const topicPath = path.join(this.topicDir, enteredFileName);
    try {
      await fs.access(topicPath);
      vscode.window.showInformationMessage(`File "${enteredFileName}" already exists. Please choose a different file name.`);
      return true;
    } catch {
      return false;
    }
  }

  private removeTopicByFilename(
    topics: TocElement[],
    fileName: string
  ): TocElement | null {
    const idx = topics.findIndex((t) => t.topic === fileName);
    if (idx > -1) {
      const [removed] = topics.splice(idx, 1);
      return removed;
    }
    for (let i = 0; i < topics.length; i += 1) {
      const extracted = this.removeTopicByFilename(
        topics[i].children,
        fileName
      );
      if (extracted) {
        return extracted;
      }
    }
    return null;
  }

  public static getAllTopicsFromTocElement(tocElements: TocElement[]): string[] {
    const result: string[] = [];
    const traverse = (elements: TocElement[]) => {
      elements.forEach((e) => {
        result.push(e.topic);
        if (e.children && e.children.length > 0) {
          traverse(e.children);
        }
      });
    };
    traverse(tocElements);
    return result;
  }

  private async findTopicInTocElements(
    topics: TocElement[],
    findTargetId: string,
    sourceTopicId: string
  ): Promise<TocElement | boolean | undefined> {
    return topics.reduce<Promise<TocElement | boolean | undefined>>(async (accPromise, t) => {
      const acc = await accPromise;
      if (acc !== undefined) return acc;

      if (t.topic === sourceTopicId) {
        return t.children.some(child => child.topic === findTargetId) ? false : undefined;
      }

      if (t.topic === findTargetId) {
        return t.children.some(child => child.topic === sourceTopicId) ? false : t;
      }

      return this.findTopicInTocElements(t.children, findTargetId, sourceTopicId);
    }, Promise.resolve(undefined));
  }

  private async removeTopicFromDoc(
    topics: TocElement[],
    topicId: string
  ): Promise<TocElement | undefined> {
    return topics.reduce<Promise<TocElement | undefined>>(async (accPromise, _, i) => {
      const acc = await accPromise;
      if (acc !== undefined) return acc;

      if (topics[i].topic === topicId) {
        return topics.splice(i, 1)[0];
      }

      return this.removeTopicFromDoc(topics[i].children, topicId);
    }, Promise.resolve(undefined));
  }

  private findTopicByFilename(
    topics: TocElement[],
    fileName: string
  ): TocElement | undefined {
    return topics.reduce<TocElement | undefined>((acc, t) => {
      if (acc) return acc;
      if (t.topic === fileName) return t;
      return this.findTopicByFilename(t.children, fileName);
    }, undefined);
  }
}
