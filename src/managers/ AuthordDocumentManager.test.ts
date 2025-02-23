import * as path from 'path';
import { AuthordConfig, InstanceProfile } from '../utils/types';
import FileService from '../services/FileService';
import TopicsService from '../services/TopicsService';
import AuthordDocumentManager from './AuthordDocumentManager';

jest.mock('../services/FileService');
jest.mock('../services/TopicsService');
jest.mock('path');

describe('AuthordDocumentManager', () => {
  const mockConfigPath = 'config.json';
  let manager: AuthordDocumentManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new AuthordDocumentManager(mockConfigPath);

    // Mock path functions
    (path.dirname as jest.Mock).mockReturnValue('/mock/dir');
    (path.join as jest.Mock).mockImplementation((...args: string[]) => args.join('/'));
  });

  describe('reloadConfiguration', () => {
    it('should load config and update TOC titles', async () => {
      const mockConfig: AuthordConfig = {
          instances: [
              {
                  name: 'Documentation 1',
                  'toc-elements': [
                      { topic: 'topic1.md', title: '', children: [] },
                      { topic: 'topic2.md', title: '', children: [] },
                  ],
              },
          ],
      } as unknown as AuthordConfig;

      (FileService.fileExists as jest.Mock).mockResolvedValue(true);
      (FileService.readJsonFile as jest.Mock).mockResolvedValue(mockConfig);

      // Instead of spyOn for a private method, directly mock it on 'manager' with bracket notation
      (manager as any).extractMarkdownTitle = jest
        .fn()
        .mockImplementation((topic: string) => Promise.resolve(`Title for ${topic}`));

      await manager.reload();

      expect(manager.configData).toEqual(mockConfig);
      // Ensure titles were updated
      expect(manager.configData?.instances?.[0]['toc-elements'][0].title).toBe('Title for topic1.md');
      expect(manager.configData?.instances?.[0]['toc-elements'][1].title).toBe('Title for topic2.md');
      expect((manager as any).extractMarkdownTitle).toHaveBeenCalledTimes(2);
    });

    it('should handle missing config file', async () => {
      (FileService.fileExists as jest.Mock).mockResolvedValue(false);

      await manager.reload();

      expect(manager.configData).toBeUndefined();
    });
  });

  describe('initializeConfigurationFile', () => {
    it('should create default config file and save it', async () => {
      await manager.initializeConfigurationFile();

      expect(FileService.writeNewFile).toHaveBeenCalledWith(mockConfigPath, '{}');
      expect(manager.configData).toEqual(AuthordDocumentManager.defaultConfigJson());
      expect(FileService.updateJsonFile).toHaveBeenCalled();
    });
  });

  describe('defaultConfigJson', () => {
    it('should return the default configuration', () => {
      const defaultConfig = AuthordDocumentManager.defaultConfigJson();
      expect(defaultConfig).toEqual({
        schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'Authord Settings',
        type: 'object',
        topics: { dir: 'topics' },
        images: { dir: 'images', version: '1.0', 'web-path': 'images' },
        instances: [],
      });
    });
  });

  describe('parseConfigFile', () => {
    it('should return parsed config when file exists', async () => {
      const mockConfig = { instances: [] };
      (FileService.fileExists as jest.Mock).mockResolvedValue(true);
      (FileService.readJsonFile as jest.Mock).mockResolvedValue(mockConfig);

      const result = await (manager as any).parseConfigFile();
      expect(result).toEqual(mockConfig);
    });

    it('should return undefined when file does not exist', async () => {
      (FileService.fileExists as jest.Mock).mockResolvedValue(false);

      const result = await (manager as any).parseConfigFile();
      expect(result).toBeUndefined();
    });
  });

  describe('saveConfigurationFile', () => {
    it('should save config data if configData is defined', async () => {
      manager.configData = AuthordDocumentManager.defaultConfigJson();

      await manager.saveConfigurationFile();

      expect(FileService.updateJsonFile).toHaveBeenCalledWith(mockConfigPath, expect.any(Function));
    });

    it('should not save if configData is undefined', async () => {
      await manager.saveConfigurationFile();
      expect(FileService.updateJsonFile).not.toHaveBeenCalled();
    });
  });

  describe('getTopicsDirectory', () => {
    it('should return directory from config', () => {
      manager.configData = { topics: { dir: 'custom-topics' } } as AuthordConfig;
      expect(manager.getTopicsDirectory()).toBe('/mock/dir/custom-topics');
    });

    it('should return default directory when config is missing topics', () => {
      manager.configData = {} as AuthordConfig;
      expect(manager.getTopicsDirectory()).toBe('/mock/dir/topics');
    });
  });

  describe('getImagesDirectory', () => {
    it('should return directory from config', () => {
      manager.configData = { images: { dir: 'custom-images' } } as AuthordConfig;
      expect(manager.getImagesDirectory()).toBe('/mock/dir/custom-images');
    });

    it('should return default directory when config is missing images', () => {
      manager.configData = {} as AuthordConfig;
      expect(manager.getImagesDirectory()).toBe('/mock/dir/images');
    });
  });

  describe('createDocumentation', () => {
    const newDoc: InstanceProfile = {
      id: 'doc1',
      name: 'Documentation One',
      'toc-elements': [
        { topic: 'topic1.md', title: '', children: [] },
      ],
    };

    beforeEach(() => {
      manager.configData = { instances: [] } as AuthordConfig;
    });

    it('should add documentation, create topic file, and save if file exists', async () => {
      (FileService.fileExists as jest.Mock).mockResolvedValue(true);

      const createTopicMarkdownFileSpy = jest
        .spyOn(manager as any, 'createTopicMarkdownFile')
        .mockResolvedValue(undefined);

      await manager.createInstance(newDoc);

      expect(manager.instances).toContainEqual(newDoc);
      expect(createTopicMarkdownFileSpy).toHaveBeenCalledWith({ topic: 'topic1.md', title: '', children: [] });
      // Because the topic file exists, config should be updated
      expect(FileService.updateJsonFile).toHaveBeenCalled();
    });

    it('should add documentation but not save if file does not exist after creation', async () => {
      (FileService.fileExists as jest.Mock).mockResolvedValue(false);

      const createTopicMarkdownFileSpy = jest
        .spyOn(manager as any, 'createTopicMarkdownFile')
        .mockResolvedValue(undefined);

      await manager.createInstance(newDoc);

      expect(manager.instances).toContainEqual(newDoc);
      expect(createTopicMarkdownFileSpy).toHaveBeenCalledWith({ topic: 'topic1.md', title: '', children: [] });
      // No save because the file wasn't found
      expect(FileService.updateJsonFile).not.toHaveBeenCalled();
    });

    it('should handle the case where no firstTopic exists', async () => {
      const docWithoutTopics: InstanceProfile = {
        id: 'doc2',
        name: 'Documentation Two',
        'toc-elements': [],
      };

      await manager.createInstance(docWithoutTopics);

      expect(manager.instances).toContainEqual(docWithoutTopics);
      // No topic to create => no checks for file existence
      expect(FileService.fileExists).not.toHaveBeenCalled();
      expect(FileService.updateJsonFile).not.toHaveBeenCalled();
    });
  });

  describe('removeDocumentation', () => {
    const doc: InstanceProfile = {
      id: 'doc1',
      name: 'Documentation One',
      'toc-elements': [{ topic: 'topic1.md', title: '', children: [] }],
    };

    it('should remove documentation and delete files', async () => {
      manager.instances = [doc];
      manager.configData = { instances: manager.instances } as AuthordConfig;
      (TopicsService.getAllTopicsFromTocElement as jest.Mock).mockReturnValue(['topic1.md']);

      const result = await manager.removeInstance('doc1');
      expect(result).toBe(true);
      expect(manager.instances).not.toContainEqual(doc);
      expect(FileService.deleteFileIfExists).toHaveBeenCalledWith('/mock/dir/topics/topic1.md');
      expect(FileService.updateJsonFile).toHaveBeenCalled();
    });

    it('should return false if documentation is not found', async () => {
      const result = await manager.removeInstance('docX');
      expect(result).toBe(false);
      expect(FileService.deleteFileIfExists).not.toHaveBeenCalled();
      expect(FileService.updateJsonFile).not.toHaveBeenCalled();
    });

    it('should return false if configData is undefined', async () => {
      manager.configData = undefined;
      manager.instances = [
        {
          id: 'doc2',
          name: 'Documentation Two',
          'toc-elements': [],
        },
      ];

      const result = await manager.removeInstance('doc2');
      expect(result).toBe(false);
      expect(FileService.deleteFileIfExists).not.toHaveBeenCalled();
      expect(FileService.updateJsonFile).not.toHaveBeenCalled();
    });
  });

  describe('saveDocumentationConfig', () => {
    const docId = 'docA';
    let existingDoc: InstanceProfile;
    let updatedDoc: InstanceProfile;

    beforeEach(() => {
      manager.configData = { instances: [] } as AuthordConfig;
      existingDoc = {
        id: docId,
        name: 'Existing Doc',
        'toc-elements': [],
      };
      updatedDoc = {
        id: docId,
        name: 'Updated Doc',
        'toc-elements': [
          { topic: 'updated.md', title: '', children: [] },
        ],
      };
    });

    it('should update existing documentation', async () => {
      manager.instances = [existingDoc];
      manager.configData!.instances = manager.instances;

      await manager.saveInstance(updatedDoc);

      expect(manager.instances).toContainEqual(updatedDoc);
      expect(FileService.updateJsonFile).toHaveBeenCalled();
    });

    it('should add new documentation if it does not exist', async () => {
      await manager.saveInstance(updatedDoc);

      expect(manager.instances).toContainEqual(updatedDoc);
      expect(FileService.updateJsonFile).toHaveBeenCalled();
    });

    it('should do nothing if configData is undefined', async () => {
      manager.configData = undefined;

      await manager.saveInstance(updatedDoc);

      expect(FileService.updateJsonFile).not.toHaveBeenCalled();
      expect(manager.instances.length).toBe(0);
    });
  });
});
