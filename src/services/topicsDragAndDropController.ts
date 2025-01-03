import * as vscode from 'vscode';
import { TopicsProvider, TopicsItem } from './topicsProvider';

export class TopicsDragAndDropController implements vscode.TreeDragAndDropController<TopicsItem> {
  dropMimeTypes = ['application/json'];
  dragMimeTypes = ['text/uri-list', 'application/json'];

  constructor(private topicsProvider: TopicsProvider) {}

  handleDrag(
    sourceItems: readonly TopicsItem[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void {
    if (token.isCancellationRequested) {
      return; // Exit early if the operation is canceled
    }

    const draggedIds = sourceItems.map(item => item.topic);
    dataTransfer.set(
      'application/json',
      new vscode.DataTransferItem(JSON.stringify(draggedIds))
    );
  }

  async handleDrop(
    targetItem: TopicsItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (token.isCancellationRequested) {
      return; // Exit early if the operation is canceled
    }

    if (!targetItem) {
      return;
    }

    const rawData = dataTransfer.get('application/json');
    if (!rawData) {
      return;
    }

    const draggedIds: string[] = JSON.parse(rawData.value.toString());

    for (const sourceTopicId of draggedIds) {
      if (token.isCancellationRequested) {
        return; // Stop processing if canceled mid-operation
      }
      await this.topicsProvider.moveTopic(sourceTopicId, targetItem.topic);
    }
  }
}
