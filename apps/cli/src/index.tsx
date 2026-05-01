import React, { useEffect, useState } from "react";
import { Box, Newline, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ChatTurn, Session } from "@guanmao/shared";

type CreateSessionResponse = {
  session: Session;
};

type SendMessageResponse = {
  session: Session;
  user: ChatTurn;
  assistant: ChatTurn;
};

const endpoint = process.env.GUANMAO_SERVER_URL ?? "http://localhost:3001";

type StreamTokenPayload = {
  delta: string;
};

type StreamDonePayload = SendMessageResponse;

const streamSse = async ({
  url,
  body,
  onToken,
  onDone,
  onError,
}: {
  url: string;
  body: unknown;
  onToken: (payload: StreamTokenPayload) => void;
  onDone: (payload: StreamDonePayload) => void;
  onError: (message: string) => void;
}) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error("无法建立流式连接");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const flushEvent = (raw: string) => {
    const lines = raw
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        const chunk = line.slice("data:".length).trim();
        data = data ? `${data}\n${chunk}` : chunk;
      }
    }
    if (!data) return;
    try {
      const payload = JSON.parse(data) as unknown;
      if (event === "token") {
        onToken(payload as StreamTokenPayload);
      } else if (event === "done") {
        onDone(payload as StreamDonePayload);
      } else if (event === "error") {
        const message =
          typeof (payload as any)?.error === "string"
            ? (payload as any).error
            : "stream error";
        onError(message);
      }
    } catch {
      // ignore malformed chunks
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      flushEvent(raw);
      idx = buffer.indexOf("\n\n");
    }
  }
};

function App() {
  const { exit } = useApp();
  const [session, setSession] = useState<Session>();
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useInput((inputValue, key) => {
    if ((key.ctrl && inputValue === "c") || key.escape) {
      exit();
    }
  });

  useEffect(() => {
    const setup = async () => {
      try {
        const response = await fetch(`${endpoint}/api/sessions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          throw new Error("无法初始化会话");
        }

        const data = (await response.json()) as CreateSessionResponse;
        setSession(data.session);
      } catch (setupError) {
        setError(
          setupError instanceof Error ? setupError.message : "初始化失败",
        );
      }
    };

    void setup();
  }, []);

  const submit = async () => {
    const content = input.trim();
    if (!session || !content || submitting) {
      return;
    }

    setInput("");
    setSubmitting(true);
    setError(undefined);

    try {
      const optimisticUser: ChatTurn = {
        id: `cli-user-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      const optimisticAssistantId = `cli-assistant-${Date.now()}`;
      const optimisticAssistant: ChatTurn = {
        id: optimisticAssistantId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      };

      setSession((current) =>
        current
          ? {
              ...current,
              messages: [...current.messages, optimisticUser, optimisticAssistant],
            }
          : current,
      );

      await streamSse({
        url: `${endpoint}/api/sessions/${session.id}/messages/stream`,
        body: { content },
        onToken: ({ delta }) => {
          setSession((current) => {
            if (!current) return current;
            return {
              ...current,
              messages: current.messages.map((msg) =>
                msg.id === optimisticAssistantId
                  ? { ...msg, content: `${msg.content}${delta}` }
                  : msg,
              ),
            };
          });
        },
        onDone: (payload) => {
          setSession(payload.session);
        },
        onError: (message) => {
          throw new Error(message);
        },
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "发送消息失败",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="greenBright">Guanmao Agent CLI</Text>
      <Text dimColor>{endpoint}</Text>
      <Text dimColor>
        {session ? `session: ${session.title}` : "正在初始化会话..."}
      </Text>
      <Newline />
      <Box flexDirection="column">
        {(session?.messages ?? []).map((message) => (
          <Text key={message.id}>
            <Text color={message.role === "assistant" ? "cyan" : "yellow"}>
              [{message.role}]
            </Text>{" "}
            {message.content}
          </Text>
        ))}
      </Box>
      <Newline />
      {error ? <Text color="red">{error}</Text> : null}
      <Box>
        <Text color="magenta">{submitting ? "发送中> " : "输入> "}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={() => {
            void submit();
          }}
          placeholder={session ? "输入消息并回车发送" : "正在连接 server..."}
        />
      </Box>
    </Box>
  );
}

render(<App />);
