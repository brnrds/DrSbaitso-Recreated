import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HARNESS_CHAT_MODEL,
  harnessChatModels,
  hasDirectHarnessCredentials,
  resolveChatBackend,
} from '../../api/_lib/chatBackend';

describe('resolveChatBackend', () => {
  it('forces gemini or harness when CHAT_BACKEND is set', () => {
    expect(resolveChatBackend({ CHAT_BACKEND: 'gemini', GEMINI_API_KEY: 'k' })).toBe('gemini');
    expect(resolveChatBackend({ CHAT_BACKEND: 'harness', GEMINI_API_KEY: 'k' })).toBe('harness');
  });

  it('prefers harness when gateway or provider credentials exist', () => {
    expect(resolveChatBackend({ GEMINI_API_KEY: 'k', AI_GATEWAY_API_KEY: 'gw' })).toBe('harness');
    expect(resolveChatBackend({ GEMINI_API_KEY: 'k', OPENAI_API_KEY: 'o' })).toBe('harness');
  });

  it('uses harness when no Gemini key is configured', () => {
    expect(resolveChatBackend({})).toBe('harness');
  });

  it('defaults to gemini when only GEMINI_API_KEY is set', () => {
    expect(resolveChatBackend({ GEMINI_API_KEY: 'k' })).toBe('gemini');
  });
});

describe('hasDirectHarnessCredentials', () => {
  it('detects non-empty gateway and provider env vars', () => {
    expect(hasDirectHarnessCredentials({ AI_GATEWAY_API_KEY: 'x' })).toBe(true);
    expect(hasDirectHarnessCredentials({ GEMINI_API_KEY: 'k' })).toBe(false);
  });
});

describe('harnessChatModels', () => {
  it('defaults the harness model and fallbacks', () => {
    expect(harnessChatModels({})).toEqual({
      chat: DEFAULT_HARNESS_CHAT_MODEL,
      chatFallbacks: ['openai/gpt-5.4', 'google/gemini-3.8-flash'],
    });
  });
});
