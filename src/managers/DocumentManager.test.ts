/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable import/no-unresolved */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */


import 'jest';
import * as vscode from 'vscode';
import * as path from 'path';
import { InstanceConfig, TocElement } from '../utils/types';
import FileService from '../services/FileService';
import DocumentManager from './DocumentManager';

jest.mock('vscode');
// Mock the FileService default export with `__esModule: true`
jest.mock('../services/FileService', () => ({
  __esModule: true,
  default: {
    deleteFileIfExists: jest.fn().mockResolvedValue(true),
    fileExists: jest.fn().mockResolvedValue(false),
    readFileAsString: jest.fn().mockResolvedValue(''),
    writeNewFile: jest.fn().mockResolvedValue(undefined),
    updateFile: jest.fn().mockImplementation(async (_path, updater) => {
      const content = '';
      await updater(content);
    }),
  },
}));


class MockDocumentManager extends DocumentManager {
  async saveDocumentationConfig(_doc: InstanceConfig, _filePath?: string): Promise<void> {
    // Mock implementation
  }

  getTopicsDirectory(): string {
    return '/mock/topics';
  }

  getImagesDirectory(): string {
    return '/mock/images';
  }

  async createDocumentation(_newDocument: InstanceConfig): Promise<void> {
    // Mock implementation
  }

  async removeDocumentation(_docId: string): Promise<boolean> {
    return true;
  }

  async reloadConfiguration(): Promise<void> {
    // Mock implementation
  }

  // Expose protected methods for testing
  public testExtractMarkdownTitle(topicFile: string): Promise<string> {
    return super.extractMarkdownTitle(topicFile);
  }

  public testCreateTopicMarkdownFile(newTopic: TocElement): Promise<void> {
    return super.createTopicMarkdownFile(newTopic);
  }
}

describe('DocumentManager', () => {
  let manager: MockDocumentManager;

  beforeEach(() => {
    manager = new MockDocumentManager('/mock/config.json');
    jest.clearAllMocks();

    // Make saveDocumentationConfig a Jest spy so .toHaveBeenCalledWith() will work
    jest.spyOn(manager, 'saveDocumentationConfig').mockResolvedValue(undefined);
  });

  describe('fetchAllDocumentations', () => {
    it('should return all instances', () => {
      const mockInstances: InstanceConfig[] = [
        { id: '1', name: 'Test', 'toc-elements': [] },
      ];
      manager.instances = mockInstances;
      expect(manager.fetchAllDocumentations()).toEqual(mockInstances);
    });
  });

  describe('renameTopicFile', () => {
    it('should rename the file and save config', async () => {
      const mockDoc: InstanceConfig = { id: '1', name: 'Doc', 'toc-elements': [] };
      const oldFile = 'old.md';
      const newFile = 'new.md';
      const topicsDir = manager.getTopicsDirectory();

      await manager.renameTopicFile(oldFile, newFile, mockDoc);

      expect(vscode.workspace.fs.rename).toHaveBeenCalledWith(
        expect.objectContaining({ path: path.join(topicsDir, oldFile) }),
        expect.objectContaining({ path: path.join(topicsDir, newFile) })
      );
      expect(manager.saveDocumentationConfig).toHaveBeenCalledWith(mockDoc);
    });
  });

  describe('removeTopicFiles', () => {
    it('should delete files and save config', async () => {
      const mockDoc: InstanceConfig = { id: '1', name: 'Doc', 'toc-elements': [] };
      const files = ['file1.md', 'file2.md'];
      const topicsDir = manager.getTopicsDirectory();

      // This call is expected to resolve to `true`
      await expect(manager.removeTopicFiles(files, mockDoc)).resolves.toBe(true);

      // Now check our mocks
      expect(FileService.deleteFileIfExists).toHaveBeenCalledTimes(2);
      expect(FileService.deleteFileIfExists).toHaveBeenCalledWith(path.join(topicsDir, files[0]));
      expect(FileService.deleteFileIfExists).toHaveBeenCalledWith(path.join(topicsDir, files[1]));
      expect(manager.saveDocumentationConfig).toHaveBeenCalledWith(mockDoc);
    });
  });

  describe('createChildTopicFile', () => {
    
    it('should create topic file and save config if file exists', async () => {
      // Arrange
      const mockTopic = { topic: 'new.md', title: 'New', children: [] };
      const mockDoc = { id: '1', name: 'Doc', 'toc-elements': [] };
      (FileService.fileExists as jest.Mock).mockResolvedValue(true);
      jest.spyOn(Object.getPrototypeOf(manager), 'createTopicMarkdownFile').mockImplementation(async () => {});
      
      
      // Act
      await manager.createChildTopicFile(mockTopic, mockDoc);
    
      // Assert
      // Now we check that the protected method was called
      expect(
        Object.getPrototypeOf(manager).createTopicMarkdownFile
      ).toHaveBeenCalledWith(mockTopic);
      expect(manager.saveDocumentationConfig).toHaveBeenCalledWith(mockDoc);
    });
   
    it('should not save config if file creation failed (file does not exist)', async () => {
      const mockTopic: TocElement = { topic: 'new.md', title: 'New', children: [] };
      const mockDoc: InstanceConfig = { id: '1', name: 'Doc', 'toc-elements': [] };

      (FileService.fileExists as jest.Mock).mockResolvedValue(false);
      jest.spyOn(manager, 'testCreateTopicMarkdownFile').mockImplementation(async () => {});

      await manager.createChildTopicFile(mockTopic, mockDoc);

      // config is not saved because file creation was never done
      expect(manager.saveDocumentationConfig).not.toHaveBeenCalled();
    });
  });

  describe('extractMarkdownTitle', () => {
    it('should extract title from first heading', async () => {
      (FileService.readFileAsString as jest.Mock).mockResolvedValue('# Title\nContent');
      const title = await manager.testExtractMarkdownTitle('test.md');
      expect(title).toBe('Title');
    });

    it('should use filename if no heading found', async () => {
      (FileService.readFileAsString as jest.Mock).mockResolvedValue('Content');
      const title = await manager.testExtractMarkdownTitle('test.md');
      expect(title).toBe('<test.md>');
    });

    it('should handle read errors gracefully', async () => {
      (FileService.readFileAsString as jest.Mock).mockRejectedValue(new Error('Read failed'));
      const title = await manager.testExtractMarkdownTitle('error.md');
      expect(title).toBe('<error.md>');
    });
  });

  describe('updateMarkdownTitle', () => {
    it('should update existing title', async () => {
      let content = '# Old Title\nContent';
      (FileService.updateFile as jest.Mock).mockImplementation(async (_path, updater) => {
        content = await updater(content);
      });

      await manager.updateMarkdownTitle('test.md', 'New Title');
      expect(content).toBe('# New Title\nContent');
    });

    it('should prepend title if none exists', async () => {
      let content = 'Content';
      (FileService.updateFile as jest.Mock).mockImplementation(async (_path, updater) => {
        content = await updater(content);
      });

      await manager.updateMarkdownTitle('test.md', 'New Title');
      expect(content).toBe('# New Title\nContent');
    });
  });
});
