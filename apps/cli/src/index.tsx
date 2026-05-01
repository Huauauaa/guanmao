import React, { useEffect, useState } from "react";
import { Box, Newline, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ChatTurn, Session } from "@guanmao/agent";

type CreateSessionResponse = {
  session: Session;
};

type SendMessageResponse = {
  session: Session;
  user: ChatTurn;
  assistant: ChatTurn;
};

const endpoint = process.env.GUANMAO_SERVER_URL ?? "http://localhost:3001";

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
      const response = await fetch(
        `${endpoint}/api/sessions/${session.id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content }),
        },
      );

      if (!response.ok) {
        throw new Error("发送消息失败");
      }

      const data = (await response.json()) as SendMessageResponse;
      setSession(data.session);
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
