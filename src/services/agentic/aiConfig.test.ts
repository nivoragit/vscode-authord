import { resolveCustomChatEndpoint } from './aiConfig';

jest.mock('vscode');

describe('resolveCustomChatEndpoint', () => {
  it('adds /v1/chat/completions for DeepSeek base URL', () => {
    expect(resolveCustomChatEndpoint('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
  });

  it('keeps /v1 prefix when provided', () => {
    expect(resolveCustomChatEndpoint('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
  });

  it('leaves full chat completions endpoint untouched', () => {
    expect(resolveCustomChatEndpoint('https://api.deepseek.com/v1/chat/completions')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
  });

  it('does not inject /v1 for non-root paths', () => {
    expect(resolveCustomChatEndpoint('https://api.deepseek.com/custom')).toBe(
      'https://api.deepseek.com/custom/chat/completions'
    );
  });
});
