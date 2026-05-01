import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import {
  buildConversationReply,
  createSessionTitle,
  listSuggestedPrompts,
  type ChatTurn,
} from "@guanmao/agent";

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

app.post("/api/sessions", (req, res) => {
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
    const assistantTurn = buildConversationReply([userTurn]);
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

app.post("/api/sessions/:sessionId/messages", (req, res) => {
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
  const assistantTurn = buildConversationReply(nextMessages);

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

app.post("/api/chat", (req, res) => {
  const body = (req.body || {}) as { messages?: ChatTurn[]; message?: string };

  const existingMessages = Array.isArray(body.messages) ? body.messages : [];
  const standaloneMessage = (body.message || "").trim();
  const nextMessages = standaloneMessage
    ? [...existingMessages, createTurn("user", standaloneMessage)]
    : existingMessages;

  const message = buildConversationReply(nextMessages);
  res.status(201).json({
    message,
    messages: [...nextMessages, message],
  });
});

app.listen(port, () => {
  console.log(`guanmao agent server listening on http://localhost:${port}`);
});
