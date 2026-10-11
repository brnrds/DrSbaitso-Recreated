/** POST /api/chat: one conversational turn with a persona. See api/_lib/gemini.ts. */
import { handleChat } from './_lib/gemini.js';
import { serveChat } from './_lib/http.js';

export function POST(request: Request): Promise<Response> {
  return serveChat(request, handleChat);
}
