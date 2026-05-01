package main

import (
	"bytes"
	"context"
	"encoding/json"
	"bufio"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type ChatRequest struct {
	Message string `json:"message"`
}

type ChatResponse struct {
	ID      string   `json:"id"`
	Reply   string   `json:"reply"`
	Summary string   `json:"summary"`
	Actions []string `json:"actions"`
}

type serverChatTurn struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

type serverChatResponse struct {
	Message  serverChatTurn   `json:"message"`
	Messages []serverChatTurn `json:"messages"`
}

type serverStreamToken struct {
	Delta string `json:"delta"`
}

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) GetServerURL() string {
	baseURL := strings.TrimRight(os.Getenv("GUANMAO_SERVER_URL"), "/")
	if baseURL == "" {
		baseURL = "http://localhost:3001"
	}
	return baseURL
}

func (a *App) ChatStream(message string) {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return
	}

	emitCtx := a.ctx
	if emitCtx == nil {
		// Wails runtime APIs require the context from lifecycle hooks.
		// If startup hasn't run yet, we can't stream events to the frontend.
		return
	}

	go func() {
		doneEmitted := false
		baseURL := strings.TrimRight(os.Getenv("GUANMAO_SERVER_URL"), "/")
		if baseURL == "" {
			baseURL = "http://localhost:3001"
		}
		runtime.EventsEmit(emitCtx, "chat:status", "connecting to "+baseURL)

		payload, err := json.Marshal(ChatRequest{Message: trimmed})
		if err != nil {
			runtime.EventsEmit(emitCtx, "chat:error", "无法序列化请求："+err.Error())
			return
		}

		// Quick connectivity check to surface obvious URL/network issues.
		healthReq, err := http.NewRequestWithContext(emitCtx, http.MethodGet, baseURL+"/api/health", nil)
		if err == nil {
			healthClient := &http.Client{Timeout: 3 * time.Second}
			healthResp, healthErr := healthClient.Do(healthReq)
			if healthErr != nil {
				runtime.EventsEmit(emitCtx, "chat:error", "无法连接服务端（health check 失败）："+healthErr.Error()+"；baseURL="+baseURL)
				return
			}
			healthResp.Body.Close()
		}

		reqCtx := emitCtx
		req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, baseURL+"/api/chat/stream", bytes.NewReader(payload))
		if err != nil {
			runtime.EventsEmit(emitCtx, "chat:error", "无法创建请求："+err.Error())
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")

		client := &http.Client{Timeout: 0}
		resp, err := client.Do(req)
		if err != nil {
			runtime.EventsEmit(emitCtx, "chat:error", "无法连接服务端："+err.Error())
			return
		}
		defer resp.Body.Close()

		runtime.EventsEmit(emitCtx, "chat:status", "connected: "+resp.Status)
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			runtime.EventsEmit(emitCtx, "chat:error", "服务端返回错误状态："+resp.Status)
			return
		}

		scanner := bufio.NewScanner(resp.Body)
		// allow long lines (SSE data can be large)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

		eventName := ""
		dataLines := make([]string, 0, 8)
		runtime.EventsEmit(emitCtx, "chat:status", "stream started")

		flush := func() {
			if len(dataLines) == 0 {
				eventName = ""
				return
			}
			raw := strings.Join(dataLines, "\n")
			dataLines = dataLines[:0]
			if eventName == "" {
				eventName = "message"
			}

			switch eventName {
			case "token":
				var token serverStreamToken
				if err := json.Unmarshal([]byte(raw), &token); err == nil && token.Delta != "" {
					runtime.EventsEmit(emitCtx, "chat:token", token.Delta)
				}
			case "done":
				var done serverChatResponse
				if err := json.Unmarshal([]byte(raw), &done); err == nil {
					runtime.EventsEmit(emitCtx, "chat:done", done.Message.Content)
					doneEmitted = true
				} else {
					runtime.EventsEmit(emitCtx, "chat:done", "")
					doneEmitted = true
				}
			case "error":
				var payload map[string]any
				if err := json.Unmarshal([]byte(raw), &payload); err == nil {
					if msg, ok := payload["error"].(string); ok && msg != "" {
						runtime.EventsEmit(emitCtx, "chat:error", msg)
						return
					}
				}
				runtime.EventsEmit(emitCtx, "chat:error", "stream error")
			}

			eventName = ""
		}

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				flush()
				continue
			}
			if strings.HasPrefix(line, "event:") {
				eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
				continue
			}
			if strings.HasPrefix(line, "data:") {
				dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
				continue
			}
		}

		flush()
		if err := scanner.Err(); err != nil {
			runtime.EventsEmit(emitCtx, "chat:error", "读取流失败："+err.Error())
			return
		}

		// If server closed connection without sending `done`, ensure UI can exit loading state.
		if !doneEmitted {
			runtime.EventsEmit(emitCtx, "chat:done", "")
		}
	}()
}

func (a *App) Chat(message string) ChatResponse {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return ChatResponse{
			ID:      "desktop-empty",
			Reply:   "请输入想咨询的问题，我会继续和你对话。",
			Summary: "等待用户输入",
			Actions: []string{"输入一个需求", "描述当前问题", "继续追问"},
		}
	}

	baseURL := strings.TrimRight(os.Getenv("GUANMAO_SERVER_URL"), "/")
	if baseURL == "" {
		baseURL = "http://localhost:3001"
	}

	payload, err := json.Marshal(ChatRequest{Message: trimmed})
	if err != nil {
		return ChatResponse{
			ID:      "desktop-error",
			Reply:   "无法序列化请求：" + err.Error(),
			Summary: "序列化失败",
			Actions: []string{"检查桌面端日志", "重试"},
		}
	}

	reqCtx := a.ctx
	if reqCtx == nil {
		reqCtx = context.Background()
	}
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, baseURL+"/api/chat", bytes.NewReader(payload))
	if err != nil {
		return ChatResponse{
			ID:      "desktop-error",
			Reply:   "无法创建请求：" + err.Error(),
			Summary: "请求初始化失败",
			Actions: []string{"检查服务端地址", "重试"},
		}
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ChatResponse{
			ID:      "desktop-error",
			Reply:   "无法连接服务端：" + err.Error(),
			Summary: "连接失败",
			Actions: []string{"确认 server 已启动", "检查 GUANMAO_SERVER_URL", "重试"},
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ChatResponse{
			ID:      "desktop-error",
			Reply:   "服务端返回错误状态：" + resp.Status,
			Summary: "服务端错误",
			Actions: []string{"查看 server 日志", "重试"},
		}
	}

	var serverPayload serverChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&serverPayload); err != nil {
		return ChatResponse{
			ID:      "desktop-error",
			Reply:   "解析服务端响应失败：" + err.Error(),
			Summary: "响应解析失败",
			Actions: []string{"查看 server 返回值", "重试"},
		}
	}

	reply := strings.TrimSpace(serverPayload.Message.Content)
	if reply == "" {
		reply = "（空回复）"
	}

	return ChatResponse{
		ID:      serverPayload.Message.ID,
		Reply:   reply,
		Summary: "已通过 server 调用真实 agent",
		Actions: []string{"继续追问", "换个问题"},
	}
}
