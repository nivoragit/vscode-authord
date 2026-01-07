import * as vscode from 'vscode';
import TopicsDragAndDropController from './TopicsDragAndDropController';

jest.mock('vscode');

class MockDataTransfer {
  private readonly data = new Map<string, any>();

  set(key: string, value: any) {
    this.data.set(key, value);
  }

  get(key: string) {
    return this.data.get(key);
  }
}

describe('TopicsDragAndDropController', () => {
  let topicsProvider: { moveTopic: jest.Mock };
  let controller: TopicsDragAndDropController;

  beforeEach(() => {
    topicsProvider = { moveTopic: jest.fn().mockResolvedValue(undefined) };
    controller = new TopicsDragAndDropController(topicsProvider as any);
    jest.clearAllMocks();
  });

  it('stores dragged topic ids in the data transfer', () => {
    const dataTransfer = new MockDataTransfer();
    const token = { isCancellationRequested: false };
    const items = [{ topic: 'one' }, { topic: 'two' }] as any;

    controller.handleDrag(items, dataTransfer as any, token as any);

    const item = dataTransfer.get('application/json') as vscode.DataTransferItem;
    expect(item.value).toBe(JSON.stringify(['one', 'two']));
  });

  it('does nothing on drag when cancelled', () => {
    const dataTransfer = new MockDataTransfer();
    const token = { isCancellationRequested: true };
    const items = [{ topic: 'one' }] as any;

    controller.handleDrag(items, dataTransfer as any, token as any);

    expect(dataTransfer.get('application/json')).toBeUndefined();
  });

  it('moves topics on drop when valid data is provided', async () => {
    const dataTransfer = new MockDataTransfer();
    dataTransfer.set(
      'application/json',
      { value: Buffer.from(JSON.stringify(['a', 'b'])) }
    );

    await controller.handleDrop(
      { topic: 'target' } as any,
      dataTransfer as any,
      { isCancellationRequested: false } as any
    );

    expect(topicsProvider.moveTopic).toHaveBeenCalledTimes(2);
    expect(topicsProvider.moveTopic).toHaveBeenNthCalledWith(1, 'a', 'target');
    expect(topicsProvider.moveTopic).toHaveBeenNthCalledWith(2, 'b', 'target');
  });

  it('does not move topics when drop is cancelled or invalid', async () => {
    const dataTransfer = new MockDataTransfer();
    dataTransfer.set('application/json', { value: Buffer.from(JSON.stringify(['a'])) });

    await controller.handleDrop(
      { topic: 'target' } as any,
      dataTransfer as any,
      { isCancellationRequested: true } as any
    );

    await controller.handleDrop(
      undefined,
      dataTransfer as any,
      { isCancellationRequested: false } as any
    );

    await controller.handleDrop(
      { topic: 'target' } as any,
      new MockDataTransfer() as any,
      { isCancellationRequested: false } as any
    );

    expect(topicsProvider.moveTopic).not.toHaveBeenCalled();
  });
});
