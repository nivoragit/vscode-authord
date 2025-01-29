// Application Layer
/* eslint-disable import/no-unresolved */
import * as vscode from 'vscode';
import AbstractConfigManager from "../managers/AbstractConfigManager";
import { InstanceConfig } from "../utils/types";
import DocumentationItem from "./documentationItem";

export default class DocumentationService {
  readonly configManager: AbstractConfigManager;

  constructor(configManager: AbstractConfigManager) {
    this.configManager = configManager;
  }

  public getAllDocuments(): InstanceConfig[] {
    // Leverages getDocuments() from the new AbstractConfigManager interface
    return this.configManager.getDocuments();
  }

  public async deleteDoc(docId: string): Promise<boolean> {
    // Leverages deleteDocument(docId: string)
    return this.configManager.deleteDocument(docId);
  }

  public async renameDoc(docId: string, newName: string): Promise<boolean> {
    // Leverages renameDocument(docId: string, newName: string)
    return this.configManager.renameDocument(docId, newName);
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
    return this.getAllDocuments().map((instance) => {
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
    const existingIds = this.getAllDocuments().map((doc) => doc.id);
    return !existingIds.includes(docId);
  }
}