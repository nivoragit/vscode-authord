/* eslint-disable import/no-unresolved */ // For 'vscode' if needed
import * as vscode from 'vscode';
import TopicsProvider from './TopicsProvider';
import TopicsItem from './TopicsItem';

export default class TopicsDragAndDropController implements vscode.TreeDragAndDropController<TopicsItem> {
  private readonly topicsProvider: TopicsProvider;
  
  public dropMimeTypes: string[] = ['application/json'];

  public dragMimeTypes: string[] = ['text/uri-list', 'application/json'];

  constructor(topicsProvider: TopicsProvider) {
    this.topicsProvider = topicsProvider;
  }

  public handleDrag(
    sourceItems: readonly TopicsItem[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void {
    if (token.isCancellationRequested) {
      return;
    }

    const draggedIds = sourceItems.map((item) => item.topic);
    dataTransfer.set(
      'application/json',
      new vscode.DataTransferItem(JSON.stringify(draggedIds))
    );
  }

  public async handleDrop(
    targetItem: TopicsItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (token.isCancellationRequested) {
      return; 
    }

    if (!targetItem) {
      return;
    }

    const rawData = dataTransfer.get('application/json');
    if (!rawData) {
      return;
    }

    const draggedIds: string[] = JSON.parse(rawData.value.toString());

   
    for (let i = 0; i < draggedIds.length; i += 1) {
      if (token.isCancellationRequested) {
        return;
      }
      await this.topicsProvider.moveTopic(draggedIds[i], targetItem.topic);
    }
  }
}
