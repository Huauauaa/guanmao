export type ChatRole = "system" | "user" | "assistant";

export interface ChatTurn {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface ConversationInsights {
  summary: string;
  nextSteps: string[];
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatTurn[];
}

export { streamSseJson } from "./sse.js";
