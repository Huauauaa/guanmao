import { useMemo, useState } from "react";
import {
  App as AntdApp,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Input,
  Layout,
  List,
  Space,
  Tag,
  Typography
} from "antd";
import { RobotOutlined, UserOutlined } from "@ant-design/icons";

const { Header, Content } = Layout;
const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

type DesktopMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

declare global {
  interface Window {
    go?: {
      main?: {
        App?: {
          Chat?: (message: string) => Promise<{
            id: string;
            reply: string;
            summary: string;
            actions: string[];
          }>;
        };
      };
    };
  }
}

const starterQuestions = [
  "帮我规划一个客服机器人知识库",
  "总结一下今天要做的开发任务",
  "给出一个简洁的产品介绍话术"
];

const createId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function App() {
  const [messages, setMessages] = useState<DesktopMessage[]>([
    {
      id: "desktop-welcome",
      role: "assistant",
      content: "我是桌面端智能助手，可以直接和你对话。",
      createdAt: new Date().toISOString()
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const canSend = input.trim().length > 0 && !loading;

  const sendMessage = async (preset?: string) => {
    const content = (preset ?? input).trim();
    if (!content) {
      return;
    }

    const userMessage: DesktopMessage = {
      id: createId(),
      role: "user",
      content,
      createdAt: new Date().toISOString()
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const reply = await window.go?.main?.App?.Chat?.(content);
      setMessages((current) => [
        ...current,
        {
          id: reply?.id ?? createId(),
          role: "assistant",
          content:
            reply?.reply ??
            "当前未检测到 Wails 运行时，请使用 `wails dev` 启动桌面端。",
          createdAt: new Date().toISOString()
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "桌面端调用失败，请稍后重试。",
          createdAt: new Date().toISOString()
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(
    () => ({
      total: messages.length,
      userTurns: messages.filter((item) => item.role === "user").length
    }),
    [messages]
  );

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#2563eb",
          borderRadius: 16
        }
      }}
    >
      <AntdApp>
        <Layout className="min-h-screen bg-slate-100">
          <Header className="border-b border-slate-200 bg-white px-6">
            <div className="mx-auto flex h-full max-w-6xl items-center justify-between">
              <Space>
                <Avatar size={40} icon={<RobotOutlined />} className="bg-blue-600" />
                <div>
                  <Title level={4} className="!mb-0 !mt-3">
                    Guanmao Desktop Agent
                  </Title>
                  <Text type="secondary">Wails + React + Ant Design</Text>
                </div>
              </Space>
              <Space>
                <Tag color="blue">Messages {stats.total}</Tag>
                <Tag color="purple">User Turns {stats.userTurns}</Tag>
              </Space>
            </div>
          </Header>
          <Content className="px-4 py-6">
            <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[280px,1fr]">
              <Card title="桌面场景" className="shadow-sm">
                <Paragraph type="secondary">
                  使用本地 Wails 应用提供一个轻量桌面助手界面，适合快速问答与信息整理。
                </Paragraph>
                <Space wrap>
                  {starterQuestions.map((question) => (
                    <Button key={question} onClick={() => void sendMessage(question)}>
                      {question}
                    </Button>
                  ))}
                </Space>
              </Card>

              <Card className="shadow-sm">
                <List
                  dataSource={messages}
                  locale={{ emptyText: "开始你的第一轮对话" }}
                  renderItem={(item) => (
                    <List.Item className="!items-start">
                      <List.Item.Meta
                        avatar={
                          <Avatar
                            icon={item.role === "assistant" ? <RobotOutlined /> : <UserOutlined />}
                            className={item.role === "assistant" ? "bg-blue-600" : "bg-slate-700"}
                          />
                        }
                        title={item.role === "assistant" ? "助手" : "你"}
                        description={
                          <div className="whitespace-pre-wrap text-sm text-slate-700">
                            {item.content}
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />

                <Space direction="vertical" size="middle" className="mt-4 flex w-full">
                  <TextArea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    placeholder="输入你的问题，桌面应用会调用本地 agent 能力"
                    onPressEnter={(event) => {
                      if (!event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="primary"
                      loading={loading}
                      disabled={!canSend}
                      onClick={() => void sendMessage()}
                    >
                      发送
                    </Button>
                  </div>
                </Space>
              </Card>
            </div>
          </Content>
        </Layout>
      </AntdApp>
    </ConfigProvider>
  );
}

export default App;
