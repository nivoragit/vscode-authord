// src/views/topicProvider.ts
import * as vscode from 'vscode';
// import { TopicItem } from './topicItem';
import { TopicItem } from './topicItem.js';

export class TopicProvider implements vscode.TreeDataProvider<TopicItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TopicItem | undefined | void> = new vscode.EventEmitter<TopicItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TopicItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor() {
        // Initialize topics or fetch from a configuration
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TopicItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TopicItem): Thenable<TopicItem[]> {
        if (element === undefined) {
            // Return top-level topics
            return Promise.resolve(this.getTopics());
        } else {
            // Return subtopics
            return Promise.resolve(this.getSubtopics(element));
        }
    }

    private getTopics(): TopicItem[] {

        // const config = vscode.workspace.getConfiguration('vscode-writerjet');
        // const topicsConfig = config.get<string[]>('topics') || [];
        // return topicsConfig.map(topic => new TopicItem(topic, vscode.TreeItemCollapsibleState.Collapsed));

        // Sample data for top-level topics
        return [
            new TopicItem('Topic 1', vscode.TreeItemCollapsibleState.Collapsed),
            new TopicItem('Topic 2', vscode.TreeItemCollapsibleState.Collapsed),
        ];
    }

    private getSubtopics(_parent: TopicItem): TopicItem[] {
        // Sample data for subtopics
        return [
            new TopicItem('Subtopic 1', vscode.TreeItemCollapsibleState.None),
            new TopicItem('Subtopic 2', vscode.TreeItemCollapsibleState.None),
        ];
    }
}
