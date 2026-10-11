/**
 * Chooses how `/api/chat` reaches a language model. TTS always uses Gemini
 * (`GEMINI_API_KEY`); chat can use the server key or AI SDK v7 harness auth
 * (gateway OIDC/API key, provider keys, or a host-native subscription).
 */

export type ChatBackend = 'gemini' | 'harness';

const DIRECT_HARNESS_ENV_KEYS = [
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;

export function hasDirectHarnessCredentials(env: Record<string, string | undefined>): boolean {
  return DIRECT_HARNESS_ENV_KEYS.some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

/**
 * `auto` (default): harness when gateway/provider credentials exist, or when
 * there is no Gemini chat key (native subscription on the host); otherwise Gemini.
 */
export function resolveChatBackend(env: Record<string, string | undefined>): ChatBackend {
  const mode = env.CHAT_BACKEND?.trim().toLowerCase();
  if (mode === 'gemini') return 'gemini';
  if (mode === 'harness') return 'harness';
  if (hasDirectHarnessCredentials(env)) return 'harness';
  if (!env.GEMINI_API_KEY?.trim()) return 'harness';
  return 'gemini';
}

export function isChatConfigured(env: Record<string, string | undefined>): boolean {
  const backend = resolveChatBackend(env);
  if (backend === 'gemini') return Boolean(env.GEMINI_API_KEY?.trim());
  return true;
}

export const DEFAULT_HARNESS_CHAT_MODEL = 'anthropic/claude-sonnet-4.6';

export function harnessChatModels(env: Record<string, string | undefined>): {
  chat: string;
  chatFallbacks: string[];
} {
  const chat = env.CHAT_HARNESS_MODEL?.trim() || DEFAULT_HARNESS_CHAT_MODEL;
  const chatFallbacks =
    env.CHAT_HARNESS_FALLBACK_MODELS === undefined
      ? ['openai/gpt-5.4', 'google/gemini-3.8-flash']
      : env.CHAT_HARNESS_FALLBACK_MODELS.split(',')
          .map((m) => m.trim())
          .filter(Boolean);
  return { chat, chatFallbacks };
}
