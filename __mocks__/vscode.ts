// __mocks__/vscode.ts
export class TreeItem {
  label: string;
  
  collapsibleState: number;
  
  constructor(label: string, collapsibleState: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export const EventEmitter = jest.fn(() => ({
  event: jest.fn(),
  fire: jest.fn(),
}));

export const window = {
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showInputBox: jest.fn().mockResolvedValue("Mocked Topic Title"),
};

export const workspace = {
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn(),
    update: jest.fn(),
  }),
};

// Add this interface at the top of the file
// interface MessageItem {
//   title: string;
//   isCloseAffordance?: boolean;
// }

// // Update the mock implementations
// jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation((message: string, options: any) => {
//   return Promise.resolve({ title: 'Yes' } as MessageItem);
// });

// // Update the specific test cases
// it('should delete topic if confirmed', async () => {
//   provider.currentDocId = 'doc123';
//   const mockItem = new TopicsItem(
//     'DeleteMe',
//     vscode.TreeItemCollapsibleState.None,
//     'delete.md',
//     []
//   );

//   // Mock the warning message to return 'Yes'
//   (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce({ title: 'Yes' });

//   mockTopicsService.deleteTopic.mockResolvedValue(true);

//   await provider.deleteTopic(mockItem);
//   expect(mockTopicsService.deleteTopic).toHaveBeenCalledWith('doc123', 'delete.md');
//   expect(mockTopicsService.removeTopicFromTree).toHaveBeenCalledWith('delete.md', expect.any(Array));
//   expect(mockEmitter.fire).toHaveBeenCalled();
// });

// it('should not delete topic if not confirmed', async () => {
//   provider.currentDocId = 'doc123';
//   const mockItem = new TopicsItem(
//     'DeleteMe',
//     vscode.TreeItemCollapsibleState.None,
//     'delete.md',
//     []
//   );

//   // Mock the warning message to return undefined (user cancels)
//   (vscode.window.showWarningMessage as jest.Mock).mockResolvedValueOnce(undefined);

//   await provider.deleteTopic(mockItem);
//   expect(mockTopicsService.deleteTopic).not.toHaveBeenCalled();
//   expect(mockEmitter.fire).not.toHaveBeenCalled();
// });
