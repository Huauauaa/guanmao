import { useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntApp,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Flex,
  Input,
  Layout,
  List,
  Space,
  Tag,
  Typography,
} from "antd";
import { RobotOutlined, UserOutlined } from "@ant-design/icons";
import { streamSseJson } from "@guanmao/shared";
import type { ChatTurn, Session } from "@guanmao/shared";

const { Header, Content, Sider } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

type SessionsResponse = {
  sessions: Array<{
    id: string;
    title: string;
    preview: string;
    messageCount: number;
    updatedAt: string;
  }>;
};

type SessionResponse = {
  session: Session;
};

type PromptsResponse = {
  prompts: string[];
};

type StreamTokenPayload = { delta: string };
type StreamDonePayload = { session: Session; user: ChatTurn; assistant: ChatTurn };

const formatTime = (iso: string) => {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

function App() {
  const [sessions, setSessions] = useState<SessionsResponse["sessions"]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(
    () => input.trim().length > 0 && !loading && Boolean(activeSession),
    [activeSession, input, loading],
  );

  const refreshSessions = async () => {
    const response = await fetch(`${apiBaseUrl}/api/sessions`);
    if (!response.ok) {
      throw new Error("加载会话列表失败");
    }
    const payload = (await response.json()) as SessionsResponse;
    setSessions(payload.sessions);
  };

  const loadSession = async (sessionId: string) => {
    const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}`);
    if (!response.ok) {
      throw new Error("加载会话详情失败");
    }
    const payload = (await response.json()) as SessionResponse;
    setActiveSession(payload.session);
  };

  const createSession = async (prompt?: string) => {
    const response = await fetch(`${apiBaseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(prompt ? { prompt } : {}),
    });

    if (!response.ok) {
      throw new Error("创建会话失败");
    }

    const payload = (await response.json()) as SessionResponse;
    setActiveSession(payload.session);
    await refreshSessions();
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [promptsResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/api/prompts`),
          refreshSessions(),
        ]);

        if (!promptsResponse.ok) {
          throw new Error("加载推荐提示失败");
        }

        const promptsPayload = (await promptsResponse.json()) as PromptsResponse;
        setPrompts(promptsPayload.prompts);

        const sessionsResponse = await fetch(`${apiBaseUrl}/api/sessions`);
        const sessionsPayload = (await sessionsResponse.json()) as SessionsResponse;

        if (sessionsPayload.sessions.length > 0) {
          await loadSession(sessionsPayload.sessions[0].id);
        } else {
          await createSession();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "初始化失败";
        setActiveSession({
          id: "local-fallback",
          title: "离线提示",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [
            {
              id: "fallback",
              role: "assistant",
              content: `无法连接服务端：${message}`,
              createdAt: new Date().toISOString(),
            },
          ],
        });
      } finally {
        setBooting(false);
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 30);
    return () => window.clearTimeout(id);
  }, [activeSession?.messages?.length]);

  const handleSend = async (preset?: string) => {
    if (!activeSession) {
      return;
    }

    const content = (preset ?? input).trim();
    if (!content) {
      return;
    }

    setLoading(true);
    setInput("");

    const optimisticUserMessage: ChatTurn = {
      id: `optimistic-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    setActiveSession((current) =>
      current
        ? {
            ...current,
            messages: [...current.messages, optimisticUserMessage],
          }
        : current,
    );

    try {
      const optimisticAssistantId = `streaming-${Date.now()}`;
      setActiveSession((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: optimisticAssistantId,
                  role: "assistant",
                  content: "",
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : current,
      );

      const controller = new AbortController();
      let doneSession: Session | null = null;

      await streamSseJson<StreamTokenPayload, StreamDonePayload>({
        url: `${apiBaseUrl}/api/sessions/${activeSession.id}/messages/stream`,
        body: { content },
        signal: controller.signal,
        handlers: {
          onToken: ({ delta }: StreamTokenPayload) => {
            setActiveSession((current) => {
              if (!current) return current;
              const nextMessages = current.messages.map((msg) =>
                msg.id === optimisticAssistantId
                  ? { ...msg, content: `${msg.content}${delta}` }
                  : msg,
              );
              return { ...current, messages: nextMessages };
            });
          },
          onDone: (payload) => {
          doneSession = payload.session;
          setActiveSession(payload.session);
        },
          onError: (message) => {
          throw new Error(message);
        },
        },
      });

      if (doneSession) {
        await refreshSessions();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "服务暂时不可用，请稍后重试";
      setActiveSession((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: `error-${Date.now()}`,
                  role: "assistant",
                  content: message,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : current,
      );
    } finally {
      setLoading(false);
    }
  };

  const activeMessages = activeSession?.messages ?? [];

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#4aa3ff",
          borderRadius: 16,
          fontFamily: '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          colorText: "rgba(255,255,255,0.92)",
          colorTextSecondary: "rgba(255,255,255,0.62)",
          colorBgBase: "#05070c",
          colorBgContainer: "rgba(255,255,255,0.06)",
          colorBorder: "rgba(255,255,255,0.10)",
        },
      }}
    >
      <AntApp>
        <Layout className="gm-shell min-h-screen">
          <Sider
            width={340}
            className="border-r border-white/10 bg-transparent"
          >
            <div className="flex h-full flex-col gap-4 p-4">
              <div className="gm-card rounded-2xl px-4 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="gm-title text-lg text-white">Guanmao</div>
                    <div className="text-xs text-white/55">night desk • live sessions</div>
                  </div>
                  <div className="gm-chip rounded-full px-3 py-1 text-[11px] text-white/70">
                    {sessions.length} sessions
                  </div>
                </div>
                <div className="mt-3">
                  <Button type="primary" block onClick={() => void createSession()}>
                    新建对话
                  </Button>
                </div>
              </div>

              <Card
                size="small"
                title={<span className="text-white/85">推荐提示</span>}
                className="gm-card rounded-2xl"
              >
                <Space wrap>
                  {prompts.map((prompt) => (
                    <Button
                      key={prompt}
                      size="small"
                      className="gm-chip"
                      onClick={() => void createSession(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </Space>
              </Card>

              <Card
                size="small"
                title={<span className="text-white/85">会话列表</span>}
                className="gm-card flex-1 overflow-hidden rounded-2xl"
              >
                <List
                  className="max-h-[calc(100vh-240px)] overflow-auto"
                  dataSource={sessions}
                  locale={{ emptyText: booting ? "加载中..." : "暂无会话" }}
                  renderItem={(item) => (
                    <List.Item
                      className="cursor-pointer"
                      onClick={() => void loadSession(item.id)}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            <Text strong style={{ color: "rgba(255,255,255,0.9)" }}>
                              {item.title}
                            </Text>
                            <Tag className="gm-chip" style={{ color: "rgba(255,255,255,0.75)" }}>
                              {item.messageCount}
                            </Tag>
                          </Space>
                        }
                        description={
                          <div className="line-clamp-2 text-xs text-white/55">
                            {item.preview || "点击继续对话"}
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </div>
          </Sider>
          <Layout>
            <Header className="border-b border-white/10 bg-transparent px-6 py-4 !h-auto !leading-normal">
              <Flex justify="space-between" align="center">
                <div>
                  <Title level={3} className="gm-title" style={{ color: "white", margin: 0 }}>
                    Guanmao 智能体应用
                  </Title>
                  <Text style={{ color: "rgba(255,255,255,0.65)" }}>
                    streaming • tools • sessions
                  </Text>
                </div>
              </Flex>
            </Header>
            <Content className="p-6">
              <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_280px]">
                <div className="gm-card flex min-h-[72vh] flex-col rounded-2xl">
                  <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                    <div className="min-w-0">
                      <div className="gm-title truncate text-[18px] text-white">
                        {activeSession?.title ?? "会话"}
                      </div>
                      <div className="mt-0.5 text-xs text-white/55">
                        {activeSession ? `updated ${formatTime(activeSession.updatedAt)}` : "—"}
                      </div>
                    </div>
                    <div className="gm-chip rounded-full px-3 py-1 text-[11px] text-white/75">
                      {activeMessages.length} messages
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto px-5 py-5">
                    {activeMessages.length === 0 ? (
                      <div className="text-sm text-white/60">
                        {booting ? "初始化中..." : "开始聊天吧"}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {activeMessages.map((item) => {
                          const isAssistant = item.role === "assistant";
                          return (
                            <div
                              key={item.id}
                              className={`gm-enter flex ${isAssistant ? "justify-start" : "justify-end"}`}
                            >
                              <div className="flex max-w-[92%] items-end gap-2">
                                {isAssistant ? (
                                  <Avatar
                                    size={30}
                                    icon={<RobotOutlined />}
                                    style={{ background: "rgba(74,163,255,0.95)" }}
                                  />
                                ) : null}
                                <div
                                  className={[
                                    "gm-bubble rounded-2xl px-4 py-3",
                                    isAssistant ? "" : "gm-bubble-user",
                                  ].join(" ")}
                                >
                                  <div className="text-[11px] text-white/55">
                                    {isAssistant ? "智能体" : "你"} • {formatTime(item.createdAt)}
                                  </div>
                                  <div className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-white/90">
                                    {item.content}
                                  </div>
                                </div>
                                {!isAssistant ? (
                                  <Avatar
                                    size={30}
                                    icon={<UserOutlined />}
                                    style={{ background: "rgba(255,255,255,0.18)" }}
                                  />
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </div>

                  <div className="border-t border-white/10 px-5 py-4">
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <TextArea
                          rows={3}
                          value={input}
                          placeholder="写点具体的：目标、限制、已有上下文…"
                          onChange={(event) => setInput(event.target.value)}
                          onPressEnter={(event) => {
                            if (!event.shiftKey) {
                              event.preventDefault();
                              void handleSend();
                            }
                          }}
                        />
                        <div className="mt-2 flex items-center justify-between">
                          <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
                            Enter 发送 • Shift+Enter 换行
                          </Text>
                          <div className="flex items-center gap-2">
                            <Tag className="gm-chip" style={{ color: "rgba(255,255,255,0.78)" }}>
                              {apiBaseUrl.replace(/^https?:\/\//, "")}
                            </Tag>
                          </div>
                        </div>
                      </div>
                      <Button
                        type="primary"
                        disabled={!canSend}
                        loading={loading}
                        onClick={() => void handleSend()}
                        style={{ height: 44, paddingInline: 18 }}
                      >
                        发送
                      </Button>
                    </div>
                  </div>
                </div>

                <Card
                  title={<span className="text-white/85">能力说明</span>}
                  className="gm-card rounded-2xl"
                >
                  <Paragraph style={{ color: "rgba(255,255,255,0.70)" }}>
                    统一的 TypeScript agent 核心为不同端提供一致的对话体验。
                  </Paragraph>
                  <Paragraph style={{ color: "rgba(255,255,255,0.70)" }}>
                    Server 管理会话与消息，前端通过 SSE 获取 token 流并实时渲染。
                  </Paragraph>
                  <Paragraph style={{ color: "rgba(255,255,255,0.70)" }}>
                    你可以继续接入工具调用、鉴权、数据库持久化与多模型路由。
                  </Paragraph>
                  <div className="mt-3">
                    <div className="gm-chip rounded-xl px-3 py-2 text-xs text-white/70">
                      Tip: 让它“先问 3 个澄清问题再回答”，效果通常更稳。
                    </div>
                  </div>
                </Card>
              </div>
            </Content>
          </Layout>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
