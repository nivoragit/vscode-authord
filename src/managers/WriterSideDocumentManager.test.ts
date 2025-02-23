/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable dot-notation */

import { mocked } from 'jest-mock';
import * as path from 'path';
import WriterSideDocumentManager from './WriterSideDocumentManager';
import FileService from '../services/FileService';
import TopicsService from '../services/TopicsService';
import { InstanceProfile } from '../utils/types';

jest.mock('../services/FileService');
jest.mock('../services/TopicsService');
jest.mock('fast-xml-parser', () => ({
    XMLBuilder: jest.fn().mockImplementation(() => ({
        build: jest.fn().mockReturnValue('<xml/>'),
    })),
}));

describe('WriterSideDocumentManager', () => {
    const mockConfigPath = '/project/config.ihp';
    const mockIhpDir = path.dirname(mockConfigPath);

    let manager: WriterSideDocumentManager;

    beforeEach(() => {
        jest.clearAllMocks();
        manager = new WriterSideDocumentManager(mockConfigPath);
    });

    describe('reloadConfiguration', () => {
        it('should read IHP file and load all instances', async () => {
            // Arrange
            const mockParsedData = { ihp: { instance: [] } };
            mocked(FileService.fileExists).mockResolvedValue(true);
            mocked(FileService.readFileAsString).mockResolvedValue('<ihp/>');
            mocked(FileService.parseXmlString).mockReturnValue(mockParsedData);
            jest.spyOn(manager, 'loadAllInstances').mockResolvedValue([]);

            // Act
            await manager.reload();

            // Assert
            expect(FileService.fileExists).toHaveBeenCalledWith(mockConfigPath);
            expect(FileService.readFileAsString).toHaveBeenCalledWith(mockConfigPath);
            expect(manager.ihpData).toEqual(mockParsedData);
            expect(manager.loadAllInstances).toHaveBeenCalled();
        });
    });

    describe('Path-related methods', () => {
        it('should get IHP directory', () => {
            // getIhpDir is private in the snippet, but tested indirectly
            // or we can do a direct test if you wish to make it public or test it anyway:
            expect((manager as any).getIhpDir()).toBe(mockIhpDir);
        });

        it('should get default topics directory', () => {
            manager.ihpData = { ihp: {} };
            expect(manager.getTopicsDirectory()).toBe(path.join(mockIhpDir, 'topics'));
        });

        it('should get custom topics directory', () => {
            manager.ihpData = { ihp: { topics: { '@_dir': 'custom-topics' } } };
            expect(manager.getTopicsDirectory()).toBe(path.join(mockIhpDir, 'custom-topics'));
        });

        it('should get default images directory', () => {
            manager.ihpData = { ihp: {} };
            expect(manager.getImagesDirectory()).toBe(path.join(mockIhpDir, 'images'));
        });

        it('should get custom images directory', () => {
            manager.ihpData = { ihp: { images: { '@_dir': 'custom-images' } } };
            expect(manager.getImagesDirectory()).toBe(path.join(mockIhpDir, 'custom-images'));
        });
    });

    describe('readIhpFile', () => {
        it('should create default IHP file if it does not exist', async () => {
            mocked(FileService.fileExists).mockResolvedValue(false);
            mocked(FileService.readFileAsString).mockResolvedValue('<ihp version="2.0"></ihp>');
            mocked(FileService.parseXmlString).mockReturnValue({ ihp: {} });

            const result = await (manager as any).readIhpFile();
            expect(FileService.fileExists).toHaveBeenCalledWith(mockConfigPath);
            expect(FileService.writeNewFile).toHaveBeenCalledWith(
                mockConfigPath,
                expect.stringContaining('<?xml version="1.0"')
            );
            expect(FileService.readFileAsString).toHaveBeenCalledWith(mockConfigPath);
            expect(FileService.parseXmlString).toHaveBeenCalled();
            expect(result).toEqual({ ihp: {} });
        });

        it('should parse existing IHP file if it exists', async () => {
            mocked(FileService.fileExists).mockResolvedValue(true);
            mocked(FileService.readFileAsString).mockResolvedValue('<ihp version="2.0"></ihp>');
            mocked(FileService.parseXmlString).mockReturnValue({ ihp: {} });

            const result = await (manager as any).readIhpFile();
            expect(FileService.fileExists).toHaveBeenCalledWith(mockConfigPath);
            expect(FileService.writeNewFile).not.toHaveBeenCalled();
            expect(FileService.readFileAsString).toHaveBeenCalledWith(mockConfigPath);
            expect(result).toEqual({ ihp: {} });
        });
    });

    describe('writeIhpFile', () => {
        it('should call FileService.updateXmlFile with the current ihpData', async () => {
            manager.ihpData = { ihp: { version: '2.0' } };
            await (manager as any).writeIhpFile();
            expect(FileService.updateXmlFile).toHaveBeenCalledWith(
                mockConfigPath,
                expect.any(Function)
            );
            // We can also test what the updater function returns
            const updateFn = (FileService.updateXmlFile as jest.Mock).mock.calls[0][1];
            expect(updateFn()).toEqual({ ihp: { version: '2.0' } });
        });
    });

    describe('loadAllInstances', () => {
        it('should return an empty array if no instances', async () => {
            manager.ihpData = { ihp: {} };
            const instances = await manager.loadAllInstances();
            expect(instances).toEqual([]);
        });

        it('should filter out invalid instances and load valid ones', async () => {
            manager.ihpData = {
                ihp: {
                    instance: [
                        { '@_src': 'valid.tree' },
                        { '@_src': '' }, // invalid
                        {}, // invalid
                    ],
                },
            };

            mocked(FileService.fileExists).mockImplementation(async (filePath) => filePath.endsWith('valid.tree'));
            jest
                .spyOn(manager as any, 'parseInstanceProfile')
                .mockImplementation(async () => ({ id: 'doc1' }));

            const instances = await manager.loadAllInstances();
            expect(instances).toHaveLength(1);
            expect(instances[0].id).toBe('doc1');
        });
    });

    describe('parseInstanceProfile', () => {
        it('should return null if no valid instance-profile found', async () => {
            mocked(FileService.readFileAsString).mockResolvedValue('<invalid></invalid>');
            mocked(FileService.parseXmlString).mockReturnValue({ invalid: {} });

            const result = await (manager as any).parseInstanceProfile('/path/to/file');
            expect(result).toBeNull();
        });

        it('should parse a valid instance-profile', async () => {
            const mockXml = '<instance-profile id="doc1" name="Doc One"></instance-profile>';
            const mockData = {
                'instance-profile': {
                    '@_id': 'doc1',
                    '@_name': 'Doc One',
                    '@_start-page': 'start.md',
                    'toc-element': [],
                },
            };
            mocked(FileService.readFileAsString).mockResolvedValue(mockXml);
            mocked(FileService.parseXmlString).mockReturnValue(mockData);
            jest.spyOn(manager as any, 'buildTocElements').mockResolvedValue([]);

            const result = await (manager as any).parseInstanceProfile('/path/to/file');
            expect(result).toEqual({
                id: 'doc1',
                name: 'Doc One',
                'start-page': 'start.md',
                'toc-elements': [],
            });
        });
    });

    describe('buildTocElements (the most efficient approach)', () => {
        it('should return an empty array if no elements provided', async () => {
            const result = await (manager as any).buildTocElements(null);
            expect(result).toEqual([]);
        });

        it('should build nested TOC elements and read markdown titles in parallel', async () => {
            const mockXmlElements = [
                {
                    '@_topic': 'parent.md',
                    'toc-element': [
                        { '@_topic': 'child1.md' },
                        { '@_topic': 'child2.md' },
                    ],
                },
            ];
            // Mock extractMarkdownTitle
            jest.spyOn(manager as any, 'extractMarkdownTitle').mockImplementation(async (file) => `Title of ${file}`);
            const result = await (manager as any).buildTocElements(mockXmlElements);

            expect(result).toHaveLength(1);
            expect(result[0].topic).toBe('parent.md');
            expect(result[0].title).toBe('Title of parent.md');
            expect(result[0].children).toHaveLength(2);
            expect(result[0].children[0].title).toBe('Title of child1.md');
        });
    });

    describe('saveDocumentConfig', () => {
        it('should save document config to existing file path', async () => {
            const mockDoc: InstanceProfile = {
                id: 'doc1',
                name: 'Document 1',
                'start-page': 'start.md',
                'toc-elements': [],
            };
            jest.spyOn(manager as any, 'retrieveFilePathForDocument').mockResolvedValue('/path/to/doc1.tree');

            await manager.saveInstance(mockDoc);
            expect(manager['retrieveFilePathForDocument']).toHaveBeenCalledWith('doc1');
            expect(FileService.writeNewFile).toHaveBeenCalledWith(
                '/path/to/doc1.tree',
                expect.stringContaining('<!DOCTYPE instance-profile SYSTEM')
            );
        });

        it('should save document config to a custom file path if provided', async () => {
            const mockDoc: InstanceProfile = {
                id: 'doc2',
                name: 'Document 2',
                'start-page': '',
                'toc-elements': [],
            };
            await manager.saveInstance(mockDoc, '/custom/doc2.tree');
            expect(FileService.writeNewFile).toHaveBeenCalledWith(
                '/custom/doc2.tree',
                expect.stringContaining('<!DOCTYPE instance-profile SYSTEM')
            );
        });
    });

    describe('convertToXmlString', () => {
        it('should build XML string with the correct formatting', async () => {
            mocked(FileService.getIndentationSetting).mockResolvedValue('  ');
            const result = await (WriterSideDocumentManager as any).convertToXmlString({
                test: { '@_attr': 'value' },
            });
            expect(result).toBe('<xml/>'); // Because we mock fast-xml-parser's builder
        });
    });

    describe('retrieveFilePathForDocument', () => {
        it('should throw an error if no matching .tree file is found', async () => {
            manager.ihpData = { ihp: { instance: [{ '@_src': 'some.tree' }] } };
            mocked(FileService.fileExists).mockResolvedValue(true);
            mocked(FileService.readFileAsString).mockResolvedValue('<invalid></invalid>');
            mocked(FileService.parseXmlString).mockReturnValue({ invalid: {} });

            await expect(
                (manager as any).retrieveFilePathForDocument('doc1')
            ).rejects.toThrow('No .tree file found for docId doc1');
        });

        it('should return the correct file path if matching docId is found', async () => {
            manager.ihpData = { ihp: { instance: [{ '@_src': 'found.tree' }] } };
            mocked(FileService.fileExists).mockResolvedValue(true);
            mocked(FileService.readFileAsString).mockResolvedValue('<instance-profile id="doc1"></instance-profile>');
            mocked(FileService.parseXmlString).mockReturnValue({
                'instance-profile': { '@_id': 'doc1' },
            });

            const result = await (manager as any).retrieveFilePathForDocument('doc1');
            expect(result).toBe(path.join(mockIhpDir, 'found.tree'));
        });
    });

    describe('createDocument', () => {
        it('should create a new document and update ihpData', async () => {
            const newDoc: InstanceProfile = {
                id: 'new-doc',
                name: 'New Document',
                'start-page': '',
                'toc-elements': [{ topic: 'first.md', title: 'First', children: [] }],
            };
            // Ensure ihpData is properly set up
            manager.ihpData = { ihp: {} };
            // Mock FileService methods
            mocked(FileService.fileExists).mockResolvedValue(false);
            // Mock createTopicMarkdownFile
            jest.spyOn(manager as any, 'createTopicMarkdownFile').mockResolvedValue(undefined);
            await manager.createInstance(newDoc);
            expect(manager.ihpData.ihp.instance).toEqual([{ '@_src': 'new-doc.tree' }]);
            // The second saveDocumentConfig call occurs after the topic is created
            expect(FileService.writeNewFile).toHaveBeenCalledTimes(1)
            expect(manager.instances[0].id).toBe('new-doc');
        });
    });


    describe('removeDocument', () => {
        it('should remove the document and associated .tree file', async () => {
            manager.ihpData = { ihp: { instance: [{ '@_src': 'doc1.tree' }] } };
            manager.instances = [
                {
                    id: 'doc1',
                    name: 'Doc 1',
                    'start-page': '',
                    'toc-elements': [{ topic: 'topic1.md', title: '', children: [] }],
                },
            ];
            mocked(FileService.fileExists).mockResolvedValue(true);
            mocked(TopicsService.getAllTopicsFromTocElement).mockReturnValue(['topic1.md']);

            const result = await manager.removeInstance('doc1');
            expect(result).toBe(true);
            expect(manager.ihpData.ihp.instance).toEqual([]);
            expect(manager.instances).toEqual([]);
            expect(FileService.deleteFileIfExists).toHaveBeenCalledWith(path.join(mockIhpDir, 'topics/topic1.md'));
            expect(FileService.deleteFileIfExists).toHaveBeenCalledWith(path.join(mockIhpDir, 'doc1.tree'));
        });

        it('should return false if document is not found', async () => {
            // Directly assign ihpData since it's a normal object property
            manager.ihpData = { ihp: { instance: [{ '@_src': 'other.tree' }] } };

            // Directly assign instances instead of spying on it
            manager.instances = [{ id: 'other-doc' } as InstanceProfile];
            const result = await manager.removeInstance('doc');

            expect(result).toBe(false);
            expect(FileService.deleteFileIfExists).not.toHaveBeenCalled();
        });



    });

    describe('locateDocumentIndex', () => {
        it('should return -1 if document is not found', async () => {
            manager.ihpData = { ihp: {} };
            const result = await (manager as any).locateDocumentIndex([], 'missingDoc');
            expect(result).toBe(-1);
        });

        it('should return the correct index when docId is found', async () => {
            manager.ihpData = { ihp: { instance: [{ '@_src': 'doc1.tree' }] } };
            mocked(FileService.fileExists).mockResolvedValue(true);
            mocked(FileService.readFileAsString).mockResolvedValue('<instance-profile id="doc1"></instance-profile>');
            mocked(FileService.parseXmlString).mockReturnValue({
                'instance-profile': { '@_id': 'doc1' },
            });

            const instancesArray = [{ '@_src': 'doc1.tree' }];
            const result = await (manager as any).locateDocumentIndex(instancesArray, 'doc1');
            expect(result).toBe(0);
        });
    });
});
