// __mocks__/vscode.ts
import { jest } from '@jest/globals';
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

export const FileType = {
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

export const ViewColumn = {
  One: 1,
  Two: 2,
};

export const ProgressLocation = {
  Notification: 1,
};

export const EventEmitter = jest.fn(() => ({
  event: jest.fn(),
  fire: jest.fn(),
}));

export const window = {
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showInputBox: jest.fn(() => Promise.resolve("Mocked Topic Title")),
  showQuickPick: jest.fn(),
  showOpenDialog: jest.fn(),
  showTextDocument: jest.fn(),
  withProgress: jest.fn(),
  onDidChangeVisibleTextEditors: jest.fn(),
  onDidChangeActiveTextEditor: jest.fn(),
  onDidChangeTextEditorSelection: jest.fn(),
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    show: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
  })),
  visibleTextEditors: [],
  tabGroups: { all: [] },
  activeTextEditor: undefined,
};

export const workspace = {
  fs: {
    rename: jest.fn(() => Promise.resolve(undefined)),
    createDirectory: jest.fn(() => Promise.resolve(undefined)),
    stat: jest.fn(() => Promise.resolve(undefined)),
    readFile: jest.fn(() => Promise.resolve(new Uint8Array())),
    writeFile: jest.fn(() => Promise.resolve(undefined)),
    delete: jest.fn(() => Promise.resolve(undefined)),
  },
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn(),
    update: jest.fn(),
  }),
  onDidSaveTextDocument: jest.fn(),
  onDidChangeTextDocument: jest.fn(),
};

export const Uri = {
  file: jest.fn().mockImplementation((p) => ({
    path: p,
    fsPath: p,
    toString: () => p,
  })),
  parse: jest.fn().mockImplementation((p) => ({
    path: p,
    fsPath: p,
    toString: () => p,
  })),
};

export const lm = {
  selectChatModels: jest.fn(),
};

export const LanguageModelChatMessage = {
  User: jest.fn((content) => ({ role: 'user', content })),
  Assistant: jest.fn((content) => ({ role: 'assistant', content })),
};

export const chat = {
  createChatParticipant: jest.fn(),
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
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
