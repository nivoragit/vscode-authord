// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import { TocElement } from "../utils/types";

export default class TopicsItem extends vscode.TreeItem {
    children: TocElement[];
    
    topic: string;
  
    constructor(
      label: string,
      collapsibleState: vscode.TreeItemCollapsibleState,
      topic: string,
      children: TocElement[] = []
    ) {
      super(label, collapsibleState);
      this.children = children;
      this.contextValue = 'topic';
      this.topic = topic;
    }
  }