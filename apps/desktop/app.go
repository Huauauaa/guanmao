package main

import (
	"context"
	"strings"
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

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

	return ChatResponse{
		ID:      "desktop-demo",
		Reply:   "Desktop agent 已收到你的消息：" + trimmed + "。当前版本演示了统一对话入口，可继续接入真实模型和工具调用。",
		Summary: "Wails 桌面端本地响应",
		Actions: []string{"继续提问", "切换到 Web", "连接真实大模型"},
	}
}
