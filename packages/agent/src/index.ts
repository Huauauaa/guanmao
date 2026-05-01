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

const createId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

export const buildConversationReply = (messages: ChatTurn[]): ChatTurn => {
  const latestUserTurn = [...messages].reverse().find((message) => message.role === "user");
  const latestInput = latestUserTurn?.content.trim() || "";
  const historySummary = summarizeRecentTurns(messages);

  const replyLines = [
    "我是 Guanmao 智能助手。",
    latestInput ? `你刚刚提到：${latestInput}` : "你可以直接告诉我你的目标或问题。",
    `最近对话上下文：${historySummary}`,
    "我现在已经同时支持 Server、Web、CLI 和 Desktop 四个入口。",
  ];

  return {
    id: createId(),
    role: "assistant",
    content: replyLines.join("\n"),
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
