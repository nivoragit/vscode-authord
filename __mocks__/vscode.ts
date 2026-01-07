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

export const ViewColumn = {
  One: 1,
  Two: 2,
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
  showTextDocument: jest.fn(),
  visibleTextEditors: [],
};

export const workspace = {
  fs: {
    rename: jest.fn().mockResolvedValue(undefined),
    createDirectory: jest.fn().mockResolvedValue(undefined),
  },
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn(),
    update: jest.fn(),
  }),
};

export const Uri = {
  file: jest.fn().mockImplementation((p) => ({ path: p })),
};
export const commands = {
  executeCommand: jest.fn(),
};

export class DataTransferItem {
  value: any;

  constructor(value: any) {
    this.value = value;
  }
}

export class DataTransfer {
  private readonly data = new Map<string, DataTransferItem>();

  set(key: string, item: DataTransferItem) {
    this.data.set(key, item);
  }

  get(key: string) {
    return this.data.get(key);
  }
}
