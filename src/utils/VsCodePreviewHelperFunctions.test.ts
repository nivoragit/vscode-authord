import * as vscode from 'vscode';
import { Token } from 'markdown-it';
import {
  createCustomHtmlRenderer,
  createCustomImageRenderer,
  focusOrShowPreview,
} from './VsCodePreviewHelperFunctions';
import { DocumentationManager } from '../managers/DocumentationManager';

jest.mock('vscode');

const mockDocManager = {
  getImagesDirectory: () => '/project/images',
  getTopicsDirectory: () => '/project/topics',
} as unknown as DocumentationManager;

const createTokenWithSrc = (src: string): Token => ({
  attrIndex: jest.fn().mockReturnValue(0),
  attrs: [['src', src]],
} as unknown as Token);

describe('focusOrShowPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('focuses an existing preview editor in column two', async () => {
    const previewDoc = { uri: { scheme: 'markdown-preview' } };
    (vscode.window as any).visibleTextEditors = [
      { document: previewDoc, viewColumn: vscode.ViewColumn.Two },
    ];

    await focusOrShowPreview();

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      previewDoc,
      vscode.ViewColumn.Two,
      false
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('markdown.showPreviewToSide');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.focusFirstEditorGroup');
  });

  it('opens a preview when none is visible', async () => {
    (vscode.window as any).visibleTextEditors = [];

    await focusOrShowPreview();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('markdown.showPreviewToSide');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.focusFirstEditorGroup');
  });
});

describe('createCustomImageRenderer', () => {
  it('rewrites local image paths when editing a topic file', () => {
    const token = createTokenWithSrc('cat.png');
    const defaultRender = jest.fn(() => token.attrs![0][1]);
    const renderer = createCustomImageRenderer(defaultRender, mockDocManager);

    const result = renderer([token], 0, {}, { currentDocument: { path: '/project/topics/intro.md' } }, {});

    expect(result).toBe('../images/cat.png');
  });

  it('does not rewrite remote or absolute paths', () => {
    const remoteToken = createTokenWithSrc('https://example.com/cat.png');
    const defaultRender = jest.fn((tokens: Token[], idx: number) => tokens[idx].attrs![0][1]);
    const renderer = createCustomImageRenderer(defaultRender, mockDocManager);

    const remoteResult = renderer(
      [remoteToken],
      0,
      {},
      { currentDocument: { path: '/project/topics/intro.md' } },
      {}
    );

    expect(remoteResult).toBe('https://example.com/cat.png');

    const absoluteToken = createTokenWithSrc('/assets/cat.png');
    const absoluteResult = renderer(
      [absoluteToken],
      0,
      {},
      { currentDocument: { path: '/project/topics/intro.md' } },
      {}
    );

    expect(absoluteResult).toBe('/assets/cat.png');
  });

  it('normalizes backslashes before rewriting', () => {
    const token = createTokenWithSrc('assets\\cat.png');
    const defaultRender = jest.fn(() => token.attrs![0][1]);
    const renderer = createCustomImageRenderer(defaultRender, mockDocManager);

    const result = renderer([token], 0, {}, { currentDocument: { path: '/project/topics/intro.md' } }, {});

    expect(result).toBe('../images/assets/cat.png');
  });
});

describe('createCustomHtmlRenderer', () => {
  it('rewrites <img> src values for local images', () => {
    const token = { content: '<img src="cat.png" />' } as Token;
    const defaultRender = jest.fn(() => token.content);
    const renderer = createCustomHtmlRenderer(defaultRender, mockDocManager);

    const result = renderer(
      [token],
      0,
      {},
      { currentDocument: { path: '/project/topics/intro.md' } },
      {}
    );

    expect(result).toContain('../images/cat.png');
  });

  it('leaves remote image URLs unchanged', () => {
    const token = { content: '<img src="https://example.com/cat.png" />' } as Token;
    const defaultRender = jest.fn(() => token.content);
    const renderer = createCustomHtmlRenderer(defaultRender, mockDocManager);

    const result = renderer(
      [token],
      0,
      {},
      { currentDocument: { path: '/project/topics/intro.md' } },
      {}
    );

    expect(result).toContain('https://example.com/cat.png');
  });
});
