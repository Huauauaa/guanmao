import dotenv from "dotenv";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import {
  buildConversationReply,
  createSessionTitle,
  listSuggestedPrompts,
  streamConversationReply,
} from "@guanmao/agent";
import type { ChatTurn } from "@guanmao/shared";

type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatTurn[];
};

type CreateSessionBody = {
  prompt?: string;
};

type SendMessageBody = {
  content?: string;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

dotenv.config({ path: path.join(repoRoot, ".env"), override: true });
dotenv.config({ path: path.join(repoRoot, ".env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "OPENAI_API_KEY is not set. Agent will use fallback reply. " +
      "Check .env/.env.local and your shell environment variables.",
  );
}

const app = express();
const port = Number(process.env.PORT || 3001);
const sessions = new Map<string, Session>();

const createTurn = (role: ChatTurn["role"], content: string): ChatTurn => ({
  id: crypto.randomUUID(),
  role,
  content,
  createdAt: new Date().toISOString(),
});

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    name: "guanmao-agent-server",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    sessions: sessions.size,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/prompts", (_req, res) => {
  res.json({
    prompts: listSuggestedPrompts(),
  });
});

app.get("/api/sessions", (_req, res) => {
  const items = Array.from(sessions.values())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(({ id, title, createdAt, updatedAt, messages }) => ({
      id,
      title,
      createdAt,
      updatedAt,
      preview: messages.at(-1)?.content || "",
      messageCount: messages.length,
    }));

  res.json({ sessions: items });
});

app.post("/api/sessions", async (req, res) => {
  const body = (req.body || {}) as CreateSessionBody;
  const prompt = (body.prompt || "").trim();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const session: Session = {
    id: sessionId,
    title: createSessionTitle(prompt),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };

  if (prompt) {
    const userTurn = createTurn("user", prompt);
    const assistantTurn = await buildConversationReply([userTurn]);
    session.messages.push(userTurn, assistantTurn);
    session.updatedAt = assistantTurn.createdAt;
  }

  sessions.set(sessionId, session);
  res.status(201).json({ session });
});

app.get("/api/sessions/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json({ session });
});

app.post("/api/sessions/:sessionId/messages", async (req, res) => {
  const session = sessions.get(req.params.sessionId);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const body = (req.body || {}) as SendMessageBody;
  const content = (body.content || "").trim();

  if (!content) {
    res.status(400).json({ error: "Message content is required" });
    return;
  }

  const userTurn = createTurn("user", content);
  const nextMessages = [...session.messages, userTurn];
  const assistantTurn = await buildConversationReply(nextMessages);

  session.messages.push(userTurn, assistantTurn);
  session.updatedAt = assistantTurn.createdAt;

  if (session.messages.length === 2 && session.title === "新对话") {
    session.title = createSessionTitle(content);
  }

  res.status(201).json({
    user: userTurn,
    assistant: assistantTurn,
    session,
  });
});

app.post("/api/sessions/:sessionId/messages/stream", async (req, res) => {
  const session = sessions.get(req.params.sessionId);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(": connected\n\n");

  let aborted = false;
  req.on("aborted", () => {
    aborted = true;
  });
  res.on("close", () => {
    aborted = true;
  });

  const body = (req.body || {}) as SendMessageBody;
  const content = (body.content || "").trim();

  if (!content) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: "Message content is required" })}\n\n`,
    );
    res.end();
    return;
  }

  const userTurn = createTurn("user", content);
  const nextMessages = [...session.messages, userTurn];

  let full = "";
  try {
    for await (const delta of streamConversationReply(nextMessages)) {
      if (aborted) {
        break;
      }
      full += delta;
      res.write(`event: token\ndata: ${JSON.stringify({ delta })}\n\n`);
    }

    if (aborted) {
      return;
    }

    const assistantTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: full.trim() || "（空回复）",
      createdAt: new Date().toISOString(),
    };

    session.messages.push(userTurn, assistantTurn);
    session.updatedAt = assistantTurn.createdAt;

    if (session.messages.length === 2 && session.title === "新对话") {
      session.title = createSessionTitle(content);
    }

    res.write(
      `event: done\ndata: ${JSON.stringify({
        user: userTurn,
        assistant: assistantTurn,
        session,
      })}\n\n`,
    );
  } catch (error) {
    res.write(
      `event: error\ndata: ${JSON.stringify({
        error: error instanceof Error ? error.message : "stream failed",
      })}\n\n`,
    );
  } finally {
    res.end();
  }
});

app.post("/api/chat", async (req, res) => {
  const body = (req.body || {}) as { messages?: ChatTurn[]; message?: string };

  const existingMessages = Array.isArray(body.messages) ? body.messages : [];
  const standaloneMessage = (body.message || "").trim();
  const nextMessages = standaloneMessage
    ? [...existingMessages, createTurn("user", standaloneMessage)]
    : existingMessages;

  const message = await buildConversationReply(nextMessages);
  res.status(201).json({
    message,
    messages: [...nextMessages, message],
  });
});

app.post("/api/chat/stream", async (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(": connected\n\n");

  let aborted = false;
  req.on("aborted", () => {
    aborted = true;
  });
  res.on("close", () => {
    aborted = true;
  });

  const body = (req.body || {}) as { messages?: ChatTurn[]; message?: string };
  const existingMessages = Array.isArray(body.messages) ? body.messages : [];
  const standaloneMessage = (body.message || "").trim();
  const nextMessages = standaloneMessage
    ? [...existingMessages, createTurn("user", standaloneMessage)]
    : existingMessages;

  let full = "";
  try {
    for await (const delta of streamConversationReply(nextMessages)) {
      if (aborted) {
        break;
      }
      full += delta;
      res.write(`event: token\ndata: ${JSON.stringify({ delta })}\n\n`);
    }

    if (aborted) {
      return;
    }

    const assistant: ChatTurn = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: full.trim() || "（空回复）",
      createdAt: new Date().toISOString(),
    };

    res.write(
      `event: done\ndata: ${JSON.stringify({
        message: assistant,
        messages: [...nextMessages, assistant],
      })}\n\n`,
    );
  } catch (error) {
    res.write(
      `event: error\ndata: ${JSON.stringify({
        error: error instanceof Error ? error.message : "stream failed",
      })}\n\n`,
    );
  } finally {
    res.end();
  }
});

app.listen(port, () => {
  console.log(`guanmao agent server listening on http://localhost:${port}`);
});
