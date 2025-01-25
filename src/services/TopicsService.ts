/* eslint-disable no-param-reassign */
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { TocElement } from "../utils/types";
import AbstractConfigManager from '../managers/AbstractConfigManager';

export default class TopicsService {
  readonly topicDir: string;

  constructor(private readonly configManager: AbstractConfigManager) {
    this.topicDir = this.configManager.getTopicsDir();
  }

  public async moveTopic(
    docId: string,
    sourceTopicId: string,
    targetTopicId: string
  ): Promise<TocElement[]> {
    // Uses moveTopics(docId, sourceTopicId, targetTopicId)
    return this.configManager.moveTopics(docId, sourceTopicId, targetTopicId);
  }

  public async deleteTopic(docId: string, topicFileName: string): Promise<boolean> {
    // Uses deleteTopic(docId, topicFileName)
    return this.configManager.deleteTopic(docId, topicFileName);
  }

  public async addChildTopic(
    docId: string,
    parentTopicId: string | null,
    newTopic: TocElement
  ): Promise<boolean> {
    // Uses addChildTopic(docId, parentTopicId, newTopic)
    return this.configManager.addChildTopic(docId, parentTopicId, newTopic);
  }

  public async addSiblingTopic(
    docId: string,
    siblingTopicId: string,
    newTopic: TocElement
  ): Promise<boolean> {
    // Uses addSiblingTopic(docId, siblingTopicId, newTopic)
    return this.configManager.addSiblingTopic(docId, siblingTopicId, newTopic);
  }

  public async renameTopic(
    docId: string,
    oldTopic: string,
    newName: string,
    tree: TocElement[],
    newTopicFilename?: string
  ): Promise<boolean> {
    if (newTopicFilename) {
      const renameSuccess = this.configManager.renameTopic(docId, oldTopic, newName, newTopicFilename);
      if (!renameSuccess) {
        vscode.window.showWarningMessage('Failed to rename topic via config manager.');
        return false;
      }

      await vscode.commands.executeCommand('workbench.action.closeEditorsToTheRight');
      return this.renameTopicInTree(oldTopic, newName, tree, newTopicFilename);
    }
    return this.renameTopicInTree(oldTopic, newName, tree);
  }

  public async setAsStartPage(docId: string, topic: string): Promise<boolean> {
    return this.configManager.SetasStartPage(docId, topic);
  }

  /**
   * Utility for converting a topic title to a typical markdown filename, e.g. "My Title" -> "my-title.md"
   */
  public static formatTitleAsFilename(title: string): string {
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

  public findSiblingsByTopic(topics: TocElement[], topic: string): TocElement[] | undefined {
    for (let i = 0; i < topics.length; i += 1) {
      const t = topics[i];
      if (t.topic === topic) {
        return topics;
      }
      if (t.children?.length) {
        const found = this.findSiblingsByTopic(t.children, topic);
        if (found) return found;
      }
    }
    return undefined;
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
}
