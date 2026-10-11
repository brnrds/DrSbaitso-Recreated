/**
 * Chat turns through AI SDK v7 `HarnessAgent` + Pi, using `auth: 'auto'` so
 * credentials resolve from AI Gateway, provider env vars, or a native host
 * subscription when no explicit key is set.
 */
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createPi } from '@ai-sdk/harness-pi';
import { createJustBashNetworkSandboxSession } from '@ai-sdk/sandbox-just-bash';
import type { ChatClient } from './chatClient.js';

const PI_TOOL_NAMES = ['read', 'write', 'edit', 'bash', 'grep', 'glob', 'ls'] as const;

const CHAT_ONLY_SUFFIX = `

For this conversation you are only a talking doctor program. Reply with your in-character dialogue only — no tools, no file access, no markdown, no lists.`;

const agents = new Map<string, HarnessAgent>();

function getHarnessAgent(model: string): HarnessAgent {
  let agent = agents.get(model);
  if (!agent) {
    agent = new HarnessAgent({
      harness: createPi({
        auth: 'auto',
        reattachInProcess: false,
        thinkingLevel: 'medium',
      }),
      model,
      inactiveTools: [...PI_TOOL_NAMES],
      permissionMode: 'allow-all',
      tools: {},
    });
    agents.set(model, agent);
  }
  return agent;
}

function toHarnessMessages(
  contents: Array<{ role: 'user' | 'model'; parts: { text: string }[] }>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return contents.map((turn) => ({
    role: turn.role === 'model' ? 'assistant' : 'user',
    content: turn.parts[0]?.text ?? '',
  }));
}

export function createHarnessChatClient(): ChatClient {
  return {
    async generate({ systemInstruction, contents, model, timeoutMs }) {
      const agent = getHarnessAgent(model);
      const sandboxSession = await createJustBashNetworkSandboxSession();
      const session = await agent.createSession({ sandboxSession });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await agent.generate({
          session,
          messages: [
            { role: 'system', content: systemInstruction + CHAT_ONLY_SUFFIX },
            ...toHarnessMessages(contents),
          ],
          abortSignal: controller.signal,
        });
        return result.text.trim();
      } finally {
        clearTimeout(timer);
        await session.destroy();
        await sandboxSession.destroy();
      }
    },
  };
}
