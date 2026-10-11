/**
 * HTTP plumbing for the Gemini proxy functions: method and size checks,
 * per-client rate limiting, JSON parsing and client construction. Uses only
 * Web-standard Request/Response so it runs unchanged on Vercel's Node runtime
 * and inside the Vite dev middleware.
 */
import { GoogleGenAI } from '@google/genai';
import {
  DEFAULT_MODELS,
  LIMITS,
  createRateLimiter,
  fail,
  type ApiResult,
  type ChatModels,
  type GeminiClient,
  type Models,
} from './gemini.js';
import { createGeminiChatClient, type ChatClient } from './chatClient.js';
import {
  harnessChatModels,
  isChatConfigured,
  resolveChatBackend,
} from './chatBackend.js';
import { createHarnessChatClient } from './harnessChat.js';

export type TtsHandler = (body: unknown, client: GeminiClient, models: Models) => Promise<ApiResult>;
export type ChatHandler = (body: unknown, client: ChatClient, models: ChatModels) => Promise<ApiResult>;

interface Limiter {
  check(key: string): boolean;
}

interface ServeOptions {
  env?: Record<string, string | undefined>;
  limiter?: Limiter;
  createClient?: (apiKey: string) => GeminiClient;
}

// 20 requests per minute per client per function instance.
const defaultLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

let cachedClient: { key: string; client: GeminiClient } | undefined;
function defaultCreateClient(apiKey: string): GeminiClient {
  if (cachedClient?.key !== apiKey) {
    cachedClient = { key: apiKey, client: new GoogleGenAI({ apiKey }) };
  }
  return cachedClient.client;
}

function json(result: ApiResult, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

/**
 * Reads the body as UTF-8, or returns null once it passes `limit` bytes. The
 * cap counts bytes, not characters (multibyte text is larger on the wire),
 * and stops reading a body without Content-Length as soon as it is exceeded.
 */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Parses a comma-separated model list; unset means defaults, empty means none. */
function modelList(value: string | undefined, defaults: string[]): string[] {
  if (value === undefined) return [...defaults];
  return value
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

async function readJsonBody(request: Request, limiter: Limiter, env: Record<string, string | undefined>) {
  if (request.method !== 'POST') {
    return { error: json(fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.'), { allow: 'POST' }) };
  }

  if (!limiter.check(clientKey(request))) {
    return { error: json(fail(429, 'RATE_LIMITED', 'Too many requests. Slow down.'), { 'retry-after': '60' }) };
  }

  const declared = Number(request.headers.get('content-length'));
  if (declared > LIMITS.bodyBytes) {
    return { error: json(fail(413, 'PAYLOAD_TOO_LARGE', 'Request body too large.')) };
  }
  const raw = await readCapped(request, LIMITS.bodyBytes);
  if (raw === null) {
    return { error: json(fail(413, 'PAYLOAD_TOO_LARGE', 'Request body too large.')) };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: json(fail(400, 'BAD_REQUEST', 'Request body must be valid JSON.')) };
  }

  return { body };
}

/** @deprecated Use {@link serveChat} or {@link serveTts}. */
export type Handler = TtsHandler;

/** Gemini-backed TTS (and legacy callers that still pass a Gemini client). */
export async function serve(request: Request, handler: TtsHandler, options: ServeOptions = {}): Promise<Response> {
  return serveTts(request, handler, options);
}

export async function serveChat(request: Request, handler: ChatHandler, options: ServeOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  const limiter = options.limiter ?? defaultLimiter;

  const parsed = await readJsonBody(request, limiter, env);
  if ('error' in parsed && parsed.error) return parsed.error;

  if (!isChatConfigured(env)) {
    return json(
      fail(
        503,
        'NOT_CONFIGURED',
        'Chat is not configured. Set GEMINI_API_KEY, or use CHAT_BACKEND=harness with AI Gateway, provider keys, or a host subscription.',
      ),
    );
  }

  const backend = resolveChatBackend(env);
  let client: ChatClient;
  let models: ChatModels;

  if (backend === 'harness') {
    client = createHarnessChatClient();
    models = {
      ...harnessChatModels(env),
      now: undefined,
    };
  } else {
    const apiKey = env.GEMINI_API_KEY!;
    const gemini = (options.createClient ?? defaultCreateClient)(apiKey);
    client = createGeminiChatClient(gemini);
    models = {
      chat: env.GEMINI_CHAT_MODEL || DEFAULT_MODELS.chat,
      chatFallbacks: modelList(env.GEMINI_CHAT_FALLBACK_MODELS, DEFAULT_MODELS.chatFallbacks),
    };
  }

  return json(await handler(parsed.body, client, models));
}

export async function serveTts(request: Request, handler: TtsHandler, options: ServeOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  const limiter = options.limiter ?? defaultLimiter;

  const parsed = await readJsonBody(request, limiter, env);
  if ('error' in parsed && parsed.error) return parsed.error;

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(fail(503, 'NOT_CONFIGURED', 'The server has no Gemini API key configured.'));
  }

  const models: Models = {
    chat: env.GEMINI_CHAT_MODEL || DEFAULT_MODELS.chat,
    tts: env.GEMINI_TTS_MODEL || DEFAULT_MODELS.tts,
    chatFallbacks: modelList(env.GEMINI_CHAT_FALLBACK_MODELS, DEFAULT_MODELS.chatFallbacks),
    ttsFallbacks: modelList(env.GEMINI_TTS_FALLBACK_MODELS, DEFAULT_MODELS.ttsFallbacks),
  };
  const client = (options.createClient ?? defaultCreateClient)(apiKey);
  return json(await handler(parsed.body, client, models));
}
