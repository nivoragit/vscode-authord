/* eslint-disable no-param-reassign */
// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { InstanceProfile, TocElement } from "../utils/types";
import TopicsItem from './TopicsItem';
import { DocumentationManager } from '../managers/DocumentationManager';

export default class TopicsService {
  readonly topicDir: string;

  constructor(private readonly configManager: DocumentationManager) {
    this.topicDir = this.configManager.getTopicsDirectory();
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
        tree[i].title = newName;  
        if (newTopic) {
          tree[i].topic = newTopic; 
        }
        return true; 
      }
      if (tree[i].children && tree[i].children.length > 0) {
         
        const renamed = this.renameTopicInTree(topicId, newName, tree[i].children, newTopic);
        if (renamed) {
          return true;  
        }
      }
    }
    return false; // Return false if no match is found in the tree
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

  public static formatTitleAsFilename(title: string): string {
    return `${title.trim().toLowerCase().replace(/\s+/g, '-')}.md`;
  }

  public async moveTopic(
    docId: string,
    sourceTopicId: string,
    targetTopicId: string
  ): Promise<TocElement[]> {
    if (sourceTopicId === targetTopicId) return [];
    
    const doc = this.getDocument(docId);
    const targetTopic = await this.findTopicInTocElements(doc['toc-elements'], targetTopicId, sourceTopicId);
    if (!targetTopic) return [];

    const sourceTopic = await this.removeTopicFromDoc(doc['toc-elements'], sourceTopicId);
    if (!sourceTopic) return [];

    (targetTopic as TocElement).children.push(sourceTopic);
    this.configManager.saveInstance(doc);
    return doc['toc-elements'];
  }

  public async deleteTopic(docId: string, topicFileName: string): Promise<boolean> {
    const doc = this.getDocument(docId);
    if (doc['start-page'] === topicFileName) {
      throw new Error("Home page can't be deleted");
    }

    const removedTopic = this.removeTopicByFilename(doc['toc-elements'], topicFileName);
    if (!removedTopic) throw new Error(`Topic "${topicFileName}" not found`);

    const topicsToRemove = TopicsService.getAllTopicsFromTocElement([removedTopic]);
    this.configManager.removeTopics(topicsToRemove, doc);
    return true;
  }

  public async addChildTopic(
    docId: string,
    parentTopic: string | null,
    title: string,
    fileName: string
  ): Promise<void> {
    const doc = this.getDocument(docId);
    const newTopic = { topic: fileName, title, children: [] };

    if (parentTopic) {
      const parent = this.findTopicByFilename(doc['toc-elements'], parentTopic);
      if (!parent) throw new Error(`Parent topic "${parentTopic}" not found`);
      parent.children.push(newTopic);
    } else {
      doc['toc-elements'].push(newTopic);
    }
    this.configManager.createChildTopic(newTopic, doc);
  }

  public async renameTopic(
    docId: string,
    oldTopicFile: string,
    newName: string,
    tree: TocElement[],
    newTopicFilename?: string
  ): Promise<boolean> {
    const doc = this.getDocument(docId);
    const topic = this.findTopicByFilename(doc['toc-elements'], oldTopicFile);
    if (!topic) throw new Error(`Topic "${oldTopicFile}" not found`);

    const newTopicFile = newTopicFilename || TopicsService.formatTitleAsFilename(newName);
    if (doc['toc-elements'].length === 1) doc['start-page'] = newTopicFile;

    topic.topic = newTopicFile;
    topic.title = newName;
    this.configManager.moveTopic(oldTopicFile, newTopicFile, doc);
    return this.renameTopicInTree(oldTopicFile, newName, tree, newTopicFilename);
  }

  public async setAsStartPage(docId: string, topic: string): Promise<boolean> {
    const doc = this.getDocument(docId);
    doc['start-page'] = topic;
    await this.configManager.saveInstance(doc);
    return true;
  }

  public async updateMarkdownTitle(topicFile: string, newTitle: string): Promise<void> {
    await this.configManager.setTopicTitle(topicFile, newTitle);
  }

  public async topicExists(enteredFileName: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.topicDir, enteredFileName));
      return true;
    } catch {
      return false;
    }
  }

  private getDocument(docId: string): InstanceProfile {
    const doc = this.configManager.getInstances().find(d => d.id === docId);
    if (!doc) throw new Error(`Document "${docId}" not found`);
    return doc;
  }

}
