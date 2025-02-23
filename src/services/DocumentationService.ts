// Application Layer
/* eslint-disable import/no-unresolved */
import * as vscode from 'vscode';
import { InstanceProfile } from "../utils/types";
import DocumentationItem from "./DocumentationItem";
import { DocumentationManager } from '../managers/DocumentationManager';

export default class DocumentationService {

  readonly configManager: DocumentationManager;

  constructor(configManager: DocumentationManager) {
    this.configManager = configManager;
  }
  
  public async deleteDoc(docId: string): Promise<boolean> {
    return this.configManager.removeInstance(docId);
  }

  public async renameDoc(docId: string, newName: string): Promise<boolean> {
    try {
      const doc = this.configManager.getInstances().find(
        (d: InstanceProfile) => d.id === docId
      );
      if (!doc) {
        vscode.window.showErrorMessage(`Document "${docId}" not found for rename.`);
        return false;
      }
      doc.name = newName;
      this.configManager.saveInstance(doc);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to rename document "${docId}" -> "${newName}": ${err.message}`
      );
      return false;
    }
  }

  public async addDoc(docId: string, title: string): Promise<InstanceProfile> {
    const startPageFileName = `${title.replace(/\s+/g, '-').toLowerCase()}.md`;
    const aboutTitle = `About ${title}`;

    const tocElements = [
      {
        topic: startPageFileName,
        title: aboutTitle,
        children: [],
      },
    ];

    const newDocument: InstanceProfile = {
      id: docId,
      name: title,
      'start-page': startPageFileName,
      'toc-elements': tocElements,
    };

    await this.configManager.createInstance(newDocument);
    return newDocument;
  }

  public getDocumentationItems(): DocumentationItem[] {
    return this.configManager.getInstances().map((instance) => {
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
    const existingIds = this.configManager.getInstances().map((doc) => doc.id);
    return !existingIds.includes(docId);
  }
}
