import { useEffect, useMemo, useState } from "react";
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

function App() {
  const [sessions, setSessions] = useState<SessionsResponse["sessions"]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);

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
          onToken: ({ delta }) => {
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
          colorPrimary: "#2563eb",
          borderRadius: 14,
        },
      }}
    >
      <AntApp>
        <Layout className="min-h-screen bg-slate-950">
          <Sider width={320} className="border-r border-slate-800 bg-slate-950">
            <div className="flex h-full flex-col gap-4 p-4">
              <Button type="primary" block onClick={() => void createSession()}>
                新建对话
              </Button>
              <Card size="small" title="推荐提示">
                <Space wrap>
                  {prompts.map((prompt) => (
                    <Button key={prompt} size="small" onClick={() => void createSession(prompt)}>
                      {prompt}
                    </Button>
                  ))}
                </Space>
              </Card>
              <Card size="small" title="会话列表" className="flex-1 overflow-hidden">
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
                            <Text strong>{item.title}</Text>
                            <Tag>{item.messageCount}</Tag>
                          </Space>
                        }
                        description={
                          <div className="line-clamp-2 text-xs text-slate-500">
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
            <Header className="border-b border-slate-800 bg-slate-950 px-6">
              <Flex justify="space-between" align="center" className="h-full">
                <div>
                  <Title level={3} style={{ color: "white", margin: 0 }}>
                    Guanmao 智能体应用
                  </Title>
                  <Text style={{ color: "rgba(255,255,255,0.65)" }}>
                    React + Ant Design + Tailwind CSS + Express
                  </Text>
                </div>
                <Space>
                  <Tag color="processing">Web</Tag>
                  <Tag color="success">Agent Server</Tag>
                  <Tag color="purple">Shared Core</Tag>
                </Space>
              </Flex>
            </Header>
            <Content className="p-6">
              <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_280px]">
                <Card
                  title={activeSession?.title ?? "会话"}
                  extra={<Tag>{activeMessages.length} 条消息</Tag>}
                >
                  <List
                    dataSource={activeMessages}
                    locale={{ emptyText: booting ? "初始化中..." : "开始聊天吧" }}
                    renderItem={(item) => (
                      <List.Item>
                        <List.Item.Meta
                          avatar={
                            <Avatar
                              icon={
                                item.role === "assistant" ? (
                                  <RobotOutlined />
                                ) : (
                                  <UserOutlined />
                                )
                              }
                              style={{
                                background:
                                  item.role === "assistant" ? "#2563eb" : "#475569",
                              }}
                            />
                          }
                          title={item.role === "assistant" ? "智能体" : "你"}
                          description={
                            <div className="whitespace-pre-wrap text-slate-700">
                              {item.content}
                            </div>
                          }
                        />
                      </List.Item>
                    )}
                  />

                  <Space direction="vertical" className="mt-4 flex w-full">
                    <TextArea
                      rows={4}
                      value={input}
                      placeholder="输入问题，例如：帮我整理今天的待办事项"
                      onChange={(event) => setInput(event.target.value)}
                      onPressEnter={(event) => {
                        if (!event.shiftKey) {
                          event.preventDefault();
                          void handleSend();
                        }
                      }}
                    />
                    <Flex justify="end">
                      <Button
                        type="primary"
                        disabled={!canSend}
                        loading={loading}
                        onClick={() => void handleSend()}
                      >
                        发送
                      </Button>
                    </Flex>
                  </Space>
                </Card>

                <Card title="能力说明">
                  <Paragraph>
                    统一的 TypeScript agent 核心为不同端提供一致的对话体验。
                  </Paragraph>
                  <Paragraph>
                    Server 负责管理会话与消息，Web 使用 Ant Design 和 Tailwind
                    构建操作界面。
                  </Paragraph>
                  <Paragraph>
                    你可以继续接入真实大模型、工具调用、鉴权和数据库持久化。
                  </Paragraph>
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
