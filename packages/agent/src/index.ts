export type {
  ChatRole,
  ChatTurn,
  ConversationInsights,
  Session,
} from "@guanmao/shared";

import type { ChatTurn, ConversationInsights } from "@guanmao/shared";

import crypto from "node:crypto";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
import { z } from "zod";

const createId = () => crypto.randomUUID();

const summarizeRecentTurns = (messages: ChatTurn[]) => {
  if (messages.length === 0) {
    return "当前还没有历史上下文。";
  }

  return messages
    .slice(-4)
    .map((message) => `${message.role}: ${message.content}`)
    .join(" | ");
};

export const createSessionTitle = (input: string) => {
  const trimmed = input.trim();

  if (!trimmed) {
    return "新对话";
  }

  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
};

export const listSuggestedPrompts = () => [
  "帮我总结今天的工作重点",
  "规划一个智能客服 agent 的 MVP",
  "为这个项目写一段产品介绍",
];

const hasOpenAIConfig = () => Boolean(process.env.OPENAI_API_KEY);

const toLangChainMessages = (messages: ChatTurn[]) =>
  messages
    .map((turn) => {
      const content = turn.content ?? "";
      if (turn.role === "system") return new SystemMessage(content);
      if (turn.role === "assistant") return new AIMessage(content);
      return new HumanMessage(content);
    })
    .filter((message) => (message.content ?? "").toString().trim().length > 0);

const getTools = () => [
  tool(
    async () => new Date().toISOString(),
    {
      name: "get_time",
      description: "Get current time in ISO-8601 format.",
      schema: z.object({}),
    },
  ),
  tool(
    async ({ text }: { text: string }) => text,
    {
      name: "echo",
      description: "Echo back the input text.",
      schema: z.object({
        text: z.string().min(1),
      }),
    },
  ),
];

const createExecutor = async (options?: { streaming?: boolean }) => {
  const llm = new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: Number(process.env.OPENAI_TEMPERATURE ?? "0.3"),
    streaming: options?.streaming ?? false,
    configuration: process.env.OPENAI_BASE_URL
      ? {
          baseURL: process.env.OPENAI_BASE_URL,
        }
      : undefined,
  });
  const tools = getTools();
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      [
        "You are Guanmao, a helpful assistant.",
        "Be concise, practical, and ask clarifying questions only when necessary.",
        "You may use tools when it helps produce correct answers.",
      ].join("\n"),
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  const agent = await createOpenAIToolsAgent({ llm, tools, prompt });
  return new AgentExecutor({ agent, tools });
};

const buildFallbackReply = (messages: ChatTurn[]): ChatTurn => {
  const latestUserTurn = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const latestInput = latestUserTurn?.content.trim() || "";
  const historySummary = summarizeRecentTurns(messages);

  const replyLines = [
    "我是 Guanmao 智能助手（当前未配置 OPENAI_API_KEY，因此使用离线回复）。",
    latestInput ? `你刚刚提到：${latestInput}` : "你可以直接告诉我你的目标或问题。",
    `最近对话上下文：${historySummary}`,
    "如需启用 LangChain 模型回复：请设置环境变量 OPENAI_API_KEY。",
  ];

  return {
    id: createId(),
    role: "assistant",
    content: replyLines.join("\n"),
    createdAt: new Date().toISOString(),
  };
};

export const streamConversationReply = async function* (
  messages: ChatTurn[],
): AsyncGenerator<string> {
  if (!hasOpenAIConfig()) {
    yield buildFallbackReply(messages).content;
    return;
  }

  const latestUserTurn = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const latestInput = latestUserTurn?.content.trim() || "";

  if (!latestInput) {
    yield "我在。直接告诉我你想完成的目标，或把当前上下文贴出来。";
    return;
  }

  const executor = await createExecutor({ streaming: true });
  const history = toLangChainMessages(messages.slice(0, -1));

  const queue: string[] = [];
  let resolveNext: (() => void) | undefined;
  let finished = false;
  let invokeError: unknown;

  const waitForNext = () =>
    new Promise<void>((resolve) => {
      resolveNext = resolve;
    });

  const signalNext = () => {
    resolveNext?.();
    resolveNext = undefined;
  };

  const invokePromise = executor
    .invoke(
      {
        input: latestInput,
        chat_history: history,
      },
      {
        callbacks: [
          {
            handleLLMNewToken(token: string) {
              if (!token) return;
              queue.push(token);
              signalNext();
            },
          },
        ],
      },
    )
    .catch((error) => {
      invokeError = error;
    })
    .finally(() => {
      finished = true;
      signalNext();
    });

  while (!finished || queue.length > 0) {
    if (queue.length === 0) {
      await waitForNext();
      continue;
    }

    const token = queue.shift();
    if (token) {
      yield token;
    }
  }

  await invokePromise;
  if (invokeError) {
    throw invokeError;
  }
};

export const buildConversationReply = async (messages: ChatTurn[]): Promise<ChatTurn> => {
  if (!hasOpenAIConfig()) {
    return buildFallbackReply(messages);
  }

  const latestUserTurn = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const latestInput = latestUserTurn?.content.trim() || "";

  if (!latestInput) {
    return {
      id: createId(),
      role: "assistant",
      content: "我在。直接告诉我你想完成的目标，或把当前上下文贴出来。",
      createdAt: new Date().toISOString(),
    };
  }

  const executor = await createExecutor();
  const history = toLangChainMessages(messages.slice(0, -1));
  const result = await executor.invoke({
    input: latestInput,
    chat_history: history,
  });

  const output = typeof result.output === "string" ? result.output : String(result.output ?? "");

  return {
    id: createId(),
    role: "assistant",
    content: output.trim() || "（空回复）",
    createdAt: new Date().toISOString(),
  };
};

export const analyzeConversation = (messages: ChatTurn[]): ConversationInsights => {
  const latestUserTurn = [...messages].reverse().find((message) => message.role === "user");
  const latestInput = latestUserTurn?.content.trim() || "开始新对话";

  return {
    summary: `围绕“${latestInput}”生成了一轮对话回复`,
    nextSteps: [
      "继续追问细节",
      "让助手整理成待办事项",
      "让助手输出更正式的文案",
    ],
  };
};
