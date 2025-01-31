// Application Layer
/* eslint-disable import/no-unresolved */
import * as vscode from 'vscode';
import AbstractConfigManager from "../managers/AbstractConfigManager";
import { InstanceConfig } from "../utils/types";
import DocumentationItem from "./documentationItem";
import CacheService from './cacheService';

export default class DocumentationService {
  readonly configManager: AbstractConfigManager;

  constructor(
    private readonly cacheService: CacheService,
    configManager: AbstractConfigManager
  ) {
    this.configManager = configManager;
  }

  public async deleteDoc(docId: string): Promise<boolean> {
    // Leverages deleteDocument(docId: string)
    return this.configManager.deleteDocument(docId);
  }

  public async renameDoc(docId: string, newName: string): Promise<boolean> {
    try {
      const doc = this.cacheService.instances.find((d: InstanceConfig) => d.id === docId);
      if (!doc) {
        vscode.window.showErrorMessage(`Document "${docId}" not found for rename.`);
        return false;
      }
      this.configManager.writeConfig(doc);
      return true;

    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to rename document "${docId}" -> "${newName}": ${err.message}`
      );
      return false;
    }
  }


  public async addDoc(docId: string, title: string): Promise<InstanceConfig> {
    const startPageFileName = `${title.replace(/\s+/g, '-').toLowerCase()}.md`;
    const aboutTitle = `About ${title}`;

    // Create a minimal TOC for the new doc
    const tocElements = [
      {
        topic: startPageFileName,
        title: aboutTitle,
        children: [],
      },
    ];

    const newDocument = {
      id: docId,
      name: title,
      'start-page': startPageFileName,
      'toc-elements': tocElements,
    };
    // Leverages addDocument(newDocument: InstanceConfig)
    await this.configManager.addDocument(newDocument);
    return newDocument;
  }

  public getDocumentationItems(): DocumentationItem[] {
    return this.cacheService.instances.map((instance) => {
      const item = new DocumentationItem(
        instance.id,
        instance.name,
        vscode.TreeItemCollapsibleState.None
      );
      item.command = {
        command: 'authordDocsExtension.selectInstance',
        title: 'Select Instance',
        arguments: [instance.id],
      };
      item.contextValue = 'documentation';
      return item;
    });
  }

  public isDocIdUnique(docId: string): boolean {
    const existingIds = this.cacheService.instances.map((doc) => doc.id);
    return !existingIds.includes(docId);
  }
}