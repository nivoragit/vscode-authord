// Application Layer
/* eslint-disable import/no-unresolved */
import * as vscode from 'vscode';
import { InstanceConfig } from "../utils/types";
import DocumentationItem from "./DocumentationItem";
import { IBaseFileManager } from '../managers/IDocumentManager';

export default class DocumentationService {
  readonly configManager: IBaseFileManager;

  constructor(configManager: IBaseFileManager) {
    this.configManager = configManager;
  }
  
  public async deleteDoc(docId: string): Promise<boolean> {
    // Leverages removeDocument(docId: string)
    return this.configManager.removeDocumentation(docId);
  }

  public async renameDoc(docId: string, newName: string): Promise<boolean> {
    try {
      const doc = this.configManager.instances.find(
        (d: InstanceConfig) => d.id === docId
      );
      if (!doc) {
        vscode.window.showErrorMessage(`Document "${docId}" not found for rename.`);
        return false;
      }
      doc.name = newName;
      this.configManager.saveDocumentationConfig(doc);
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

    const newDocument: InstanceConfig = {
      id: docId,
      name: title,
      'start-page': startPageFileName,
      'toc-elements': tocElements,
    };

    // Leverages createDocument(newDocument: InstanceConfig)
    await this.configManager.createDocumentation(newDocument);
    return newDocument;
  }

  public getDocumentationItems(): DocumentationItem[] {
    return this.configManager.instances.map((instance) => {
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
    const existingIds = this.configManager.instances.map((doc) => doc.id);
    return !existingIds.includes(docId);
  }
}
