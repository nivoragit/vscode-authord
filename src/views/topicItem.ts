import path from 'path';
import * as vscode from 'vscode';

export class TopicItem extends vscode.TreeItem {
    tooltip: string;
    description: string;
    contextValue = 'topicItem';

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = `${label}`; // Initialize tooltip here
        this.description = ''; // Initialize description here
        this.iconPath = {
            light: vscode.Uri.file(path.join(__filename, '..', '..', 'resources', 'light', 'light.webp')),
            dark: vscode.Uri.file(path.join(__filename, '..', '..', 'resources', 'dark', 'dark.webp'))
        };
    }
}
