/* eslint-disable */
// topicsProvider.test.ts
jest.mock('vscode');
import * as vscode from 'vscode';
import { describe, it, beforeEach, afterEach, expect, jest } from '@jest/globals';
import { TocElement } from '../utils/types';
import TopicsItem from './TopicsItem';
import TopicsProvider from './TopicsProvider';
import TopicsService from './TopicsService';

describe('TopicsProvider', () => {
  let mockTopicsService: jest.Mocked<TopicsService>;
  let provider: TopicsProvider;
  let mockEmitter: any;

  beforeEach(() => {
    // Mocked implementation of TopicsService
    mockTopicsService = {
      createTreeItem: jest.fn(),
      moveTopic: jest.fn(),
      addChildTopic: jest.fn(),
      getParentByTopic: jest.fn(),
      renameTopic: jest.fn(),
      topicExists: jest.fn(),
      deleteTopic: jest.fn(),
      removeTopicFromTree: jest.fn(),
      findTopicItemByFilename: jest.fn(),
      setAsStartPage: jest.fn(),
    } as any;

    provider = new TopicsProvider(mockTopicsService);
    mockEmitter = (provider as any).onDidChangeTreeDataEmitter;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should refresh with new tocTree and docId', () => {
    const sampleTocTree: TocElement[] = [{ topic: 'Sample', title: 'Sample', children: [] }];
    provider.refresh(sampleTocTree, 'doc123');
    expect((provider as any).tocTree).toEqual(sampleTocTree);
    expect(provider.currentDocId).toBe('doc123');
    expect(mockEmitter.fire).toHaveBeenCalled();
  });

  it('should refresh without new tocTree and docId', () => {
    (provider as any).tocTree = [{ topic: 'Old', children: [] }];
    provider.currentDocId = 'oldDocId';

    provider.refresh(); // no arguments
    expect((provider as any).tocTree).toEqual([{ topic: 'Old', children: [] }]);
    expect(provider.currentDocId).toBe('oldDocId');
    expect(mockEmitter.fire).toHaveBeenCalled();
  });

  it('should get a TreeItem', () => {
    // Adjust the TopicsItem constructor call to the correct signature in your code.
    // For example, if it's (element: TocElement, docId: string, label: string):
    const topicItem = new TopicsItem(
      'Root 1', // label
      vscode.TreeItemCollapsibleState.Collapsed, // collapsibleState
      'root1', // topic
      [{ topic: 'child1', title: 'Child 1', children: [] }] // children
    );
    const result = provider.getTreeItem(topicItem);
    expect(result).toBe(topicItem);
  });

  it('should get children when no element is provided', async () => {
    (provider as any).tocTree = [
      { topic: 'Parent', title: 'Parent', children: [] },
      { topic: 'Parent2', title: 'Parent2', children: [] },
    ];
    mockTopicsService.createTreeItem.mockImplementation((elem: TocElement) => {
      return new TopicsItem(
        elem.title, 
        vscode.TreeItemCollapsibleState.Collapsed,
        elem.topic, 
        elem.children || [] 
      );
    });
    

    const children = await provider.getChildren();
    expect(children.length).toBe(2);
    expect(children[0].label).toBe('Parent');
    expect(children[1].label).toBe('Parent2');
  });

  it('should get children when element is provided', async () => {
    const parentTocElement: TocElement = {
      topic: 'Parent',
      title: 'Parent',
      children: [
        { topic: 'Child1', title: 'Child1', children: [] },
        { topic: 'Child2', title: 'Child2', children: [] },
      ],
    };
    // Pass correct constructor args (docId, label, etc.)
    const parentItem = new TopicsItem(
      'Parent',
      vscode.TreeItemCollapsibleState.Collapsed,
      'Parent',
      parentTocElement.children
    );
    mockTopicsService.createTreeItem.mockImplementation((elem: TocElement) => {
      return new TopicsItem(
        elem.title, 
        vscode.TreeItemCollapsibleState.Collapsed,
        elem.topic,
        elem.children || [] 
      );
    });
    

    const children = await provider.getChildren(parentItem);
    expect(children.length).toBe(2);
    expect(children[0].label).toBe('Child1');
    expect(children[1].label).toBe('Child2');
  });

  it('should move topic if currentDocId is set', async () => {
    provider.currentDocId = 'doc123';
    mockTopicsService.moveTopic.mockResolvedValue([{ topic: 'moved', title: 'moved', children: [] }]);

    await provider.moveTopic('srcId', 'tgtId');
    expect(mockTopicsService.moveTopic).toHaveBeenCalledWith('doc123', 'srcId', 'tgtId');
    expect(mockEmitter.fire).toHaveBeenCalled();
  });

  it('should not move topic if currentDocId is not set', async () => {
    await provider.moveTopic('srcId', 'tgtId');
    expect(mockTopicsService.moveTopic).not.toHaveBeenCalled();
    expect(mockEmitter.fire).not.toHaveBeenCalled();
  });

  it('should add root topic if currentDocId is set', async () => {
    provider.currentDocId = 'doc123';
    mockTopicsService.addChildTopic.mockResolvedValue({ topic: 'RootTopic', title: 'RootTopic', children: [] });
    (provider as any).tocTree = [];

    await provider.addRootTopic();
    expect(mockTopicsService.addChildTopic).toHaveBeenCalledWith('doc123', null);
    expect((provider as any).tocTree).toHaveLength(1);
    expect(mockEmitter.fire).toHaveBeenCalled();
  });

  it('should show warning if docId is not set when adding root topic', async () => {
    await provider.addRootTopic();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'No active document to add a topic to.'
    );
  });

  it('should add child topic', async () => {
    provider.currentDocId = 'doc123';
    const parentElement: TocElement = { topic: 'Parent', title: 'Parent', children: [] };
    // const parentItem = mockTopicsService.createTreeItem(parentElement);
    const parentItem = new TopicsItem(
      parentElement.title, 
      vscode.TreeItemCollapsibleState.Collapsed,
      parentElement.topic, 
      parentElement.children 
    );
    mockTopicsService.addChildTopic.mockResolvedValue({ topic: 'Child', title: 'Child', children: [] });

    await provider.addChildTopic(parentItem);
    expect(mockTopicsService.addChildTopic).toHaveBeenCalledWith('doc123', parentElement.topic);
    expect(parentItem.children).toHaveLength(1);
    expect(mockEmitter.fire).toHaveBeenCalled();
  });

  it('should show error if no parent is passed in addChildTopic', async () => {
    await provider.addChildTopic(undefined as any);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to add child topic, parent doesn't exists"
    );
  });

  it('should add sibling topic with valid sibling and docId', async () => {
    provider.currentDocId = 'doc123';
    const siblingElement = { topic: 'Sib', children: [] };
    const siblingItem = new TopicsItem(
      'Root 1', // label
      vscode.TreeItemCollapsibleState.Collapsed, // collapsibleState
      'root1', // topic
      [{ topic: 'child1', title: 'Child 1', children: [] }] // children
    );
    // If getParentByTopic returns true, it triggers addRootTopic
    mockTopicsService.getParentByTopic.mockReturnValue(true);
    mockTopicsService.addChildTopic.mockResolvedValue({ topic: 'RootTopic', title: 'RootTopic', children: [] });

    await provider.addSiblingTopic(siblingItem);
    expect(mockTopicsService.addChildTopic).toHaveBeenCalledWith('doc123', null);
    expect(mockEmitter.fire).toHaveBeenCalled();
  });

  it('should show error if sibling is invalid in addSiblingTopic', async () => {
    provider.currentDocId = 'doc123';
    await provider.addSiblingTopic(undefined as any);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Invalid sibling/topic');
  });

  it('should show error if docId is not set in addSiblingTopic', async () => {
    const siblingItem = new TopicsItem(
      'Root 1', // label
      vscode.TreeItemCollapsibleState.Collapsed, // collapsibleState
      'root1', // topic
      [{ topic: 'child1', title: 'Child 1', children: [] }] // children
    );
    provider.currentDocId = undefined; // docId not set
    await provider.addSiblingTopic(siblingItem);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'No active document to add a topic to.'
    );
  });

  it('should delete topic if confirmed', async () => {
    provider.currentDocId = 'doc123';
    const mockItem = new TopicsItem(
      'DelTopic', // Fix: Change label from "Root 1" to "DelTopic"
      vscode.TreeItemCollapsibleState.Collapsed,
      'DelTopic', // Fix: Change topic from "root1" to "DelTopic"
      []
    );
    (vscode.window.showWarningMessage as jest.MockedFunction<any>).mockResolvedValue('Yes');
    mockTopicsService.deleteTopic.mockResolvedValue(true);

    await provider.deleteTopic(mockItem);
    expect(mockTopicsService.deleteTopic).toHaveBeenCalledWith('doc123', 'DelTopic');
    expect(mockTopicsService.removeTopicFromTree).toHaveBeenCalled();
    expect(mockEmitter.fire).toHaveBeenCalled();
  });

  it('should rename topic if docId and oldTopic are valid', async () => {
    provider.currentDocId = 'doc123';
    await provider.renameTopic('oldTopic', 'newName');
    expect(mockTopicsService.renameTopic).toHaveBeenCalledWith(
      'doc123',
      'oldTopic',
      'newName',
      expect.any(Array),
      undefined
    );
    expect(mockEmitter.fire).toHaveBeenCalled();
  });

  it('should find a topic item by filename', () => {
    const mockElement = { topic: 'FindMe', title: 'FindMe', children: [] };
    mockTopicsService.findTopicItemByFilename.mockReturnValue(mockElement);

    const found = provider.findTopicItemByFilename('someFile');
    expect(found).toBe(mockElement);
    expect(mockTopicsService.findTopicItemByFilename).toHaveBeenCalledWith(
      'someFile',
      expect.any(Array)
    );
  });

  it('should set topic as start page if docId is present', async () => {
    provider.currentDocId = 'doc123';
    mockTopicsService.setAsStartPage.mockResolvedValue(true);

    const result = await provider.setAsStartPage('anyTopic');
    expect(result).toBe(true);
    expect(mockTopicsService.setAsStartPage).toHaveBeenCalledWith('doc123', 'anyTopic');
  });

  it('should show warning if docId is missing when setting topic as start page', async () => {
    const result = await provider.setAsStartPage('anyTopic');
    expect(result).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Documentation not selected');
  });
});
