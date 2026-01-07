import * as path from 'path';
import { imageRootPlugin } from './imageRootPlugin';

describe('imageRootPlugin', () => {
  it('prepends a relative folder for local images and skips remote/data URLs', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'img', properties: { src: 'cat.png' } },
        { type: 'element', tagName: 'img', properties: { src: 'https://example.com/cat.png' } },
        { type: 'element', tagName: 'img', properties: { src: 'data:image/png;base64,abc' } },
      ],
    };

    const plugin = imageRootPlugin({
      imageFolder: '/project/images',
      docPath: '/project/docs',
    });

    const transform = plugin as unknown as (tree: any) => void;
    transform(tree as any);

    const expectedFolder = path.relative('/project/docs', '/project/images');
    expect((tree.children[0] as any).properties.src).toBe(path.join(expectedFolder, 'cat.png'));
    expect((tree.children[1] as any).properties.src).toBe('https://example.com/cat.png');
    expect((tree.children[2] as any).properties.src).toBe('data:image/png;base64,abc');
  });

  it('uses the provided relative image folder as-is', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'element', tagName: 'img', properties: { src: 'logo.svg' } }],
    };

    const plugin = imageRootPlugin({
      imageFolder: 'assets',
      docPath: '/project/docs',
    });

    const transform = plugin as unknown as (tree: any) => void;
    transform(tree as any);

    expect((tree.children[0] as any).properties.src).toBe(path.join('assets', 'logo.svg'));
  });
});
