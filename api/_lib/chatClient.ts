import type { GeminiClient } from './gemini.js';

/** Abstraction over Gemini direct API and AI SDK harness chat. */
export interface ChatClient {
  generate(params: {
    systemInstruction: string;
    contents: Array<{ role: 'user' | 'model'; parts: { text: string }[] }>;
    model: string;
    timeoutMs: number;
  }): Promise<string>;
}

export function createGeminiChatClient(client: GeminiClient): ChatClient {
  return {
    async generate({ systemInstruction, contents, model, timeoutMs }) {
      const response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: 'LOW' },
          httpOptions: { timeout: timeoutMs },
        },
      });
      return typeof response?.text === 'string' ? response.text.trim() : '';
    },
  };
}
