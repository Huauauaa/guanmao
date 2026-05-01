export type SseEvent = {
  event: string;
  data: string;
};

export type SseHandlers<TToken, TDone> = {
  onToken: (payload: TToken) => void;
  onDone: (payload: TDone) => void;
  onError: (message: string) => void;
};

export async function streamSseJson<TToken, TDone>({
  url,
  body,
  signal,
  handlers,
}: {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  handlers: SseHandlers<TToken, TDone>;
}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error("unable to open stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let sawTerminalEvent = false;

  const flushEvent = (raw: string) => {
    const lines = raw
      .split(/\r?\n/)
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
        handlers.onToken(payload as TToken);
      } else if (event === "done") {
        sawTerminalEvent = true;
        handlers.onDone(payload as TDone);
      } else if (event === "error") {
        sawTerminalEvent = true;
        const message =
          typeof (payload as any)?.error === "string"
            ? (payload as any).error
            : "stream error";
        handlers.onError(message);
      }
    } catch {
      // ignore malformed chunks
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Support both LF and CRLF delimiters.
    let match = buffer.match(/\r?\n\r?\n/);
    while (match && match.index !== undefined) {
      const idx = match.index;
      const delimLen = match[0].length;
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + delimLen);
      flushEvent(raw);
      match = buffer.match(/\r?\n\r?\n/);
    }
  }

  // If stream ends without a terminal event, surface it.
  if (!sawTerminalEvent) {
    handlers.onError("stream closed");
  }
}

