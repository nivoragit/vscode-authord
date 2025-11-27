// eslint-disable-next-line import/no-unresolved
import * as vscode from 'vscode';
import DocumentationService from './DocumentationService';
import { InstanceProfile } from '../utils/types';

describe('DocumentationService', () => {
  it('uses icon from configuration when creating items', () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue('beaker'),
    });

    const mockConfigManager = {
      getInstances: jest.fn().mockReturnValue([
        { id: 'doc1', name: 'Doc 1', 'start-page': 'doc.md', 'toc-elements': [] } as InstanceProfile,
      ]),
    } as any;

    const service = new DocumentationService(mockConfigManager);
    const items = service.getDocumentationItems();

    expect(items[0].iconPath).toEqual(new vscode.ThemeIcon('beaker'));
  });
});
