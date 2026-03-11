# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个纯前端的 MQTT IoT 控制台应用,用于通过浏览器远程控制"蛤蜊破碎设备"并实时监控摄像头画面。

### 技术栈
- 纯前端: HTML + CSS + Vanilla JavaScript
- MQTT 通信: MQTT.js v5.3.5 (通过 CDN 加载)
- MQTT Broker: broker.emqx.io:8083 (WebSocket)

## 如何运行

直接在浏览器中打开 `index.html`，或通过简单的 HTTP 服务器:

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve
```

然后访问 http://localhost:8000

## MQTT 架构

### 主题结构
- **控制主题** (`langou/device001/control`): 发布控制指令 (QoS 1)
- **状态主题** (`langou/device001/status`): 订阅设备状态消息 (QoS 1)
- **监控主题** (`langou/device001/camera`): 订阅摄像头画面 (QoS 0)

### 消息格式

**控制指令** (发布到 `control`):
```json
{ "cmd": "START" }
{ "cmd": "STOP" }
```

**状态消息** (从 `status` 接收):
- 可以是 JSON 对象或纯文本
- 应用会自动尝试解析 JSON，失败则显示原始文本

**摄像头数据** (从 `camera` 接收):
- Base64 编码的 JPEG 图像
- 可能包含或不包含 `data:image/jpeg;base64,` 前缀
- 应用会自动处理两种格式

## 代码架构要点

### 摄像头数据流处理 (app.js:228-277)

摄像头画面通过 MQTT 主题接收,需要处理两种情况:
1. Buffer 格式 (需转换为 base64)
2. 已经是 base64 字符串的格式

关键逻辑在 `updateCameraFrame()` 函数:
- 检测消息格式 (string vs Buffer)
- 转换为 base64 (如果需要)
- 添加 data URI 前缀 (如果缺失)
- 更新 DOM 元素显示

### 连接状态管理

应用实现了完整的 MQTT 连接生命周期管理:
- `connect` → 订阅主题,启用按钮
- `offline` → 禁用按钮,显示断开状态
- `reconnect` → 自动重连 (5秒间隔)
- `error` → 错误处理和用户提示

### UI 反馈机制

所有操作都有即时的 UI 反馈:
- 连接状态: 实时更新状态点颜色和文本
- 按钮点击: 缩放动画反馈
- 状态消息: 时间戳 + 类型标记 (success/error/info/warning)
- 消息限制: 最多保留 20 条状态消息

## 配置修改

修改 MQTT 配置需要同时更新两处:
1. `app.js` 中的 `MQTT_CONFIG` 和 `TOPICS` 对象
2. `index.html` 底部的连接信息显示面板

## 移动端支持

应用针对移动端做了优化:
- 响应式布局 (media query @640px)
- 禁用双击缩放
- `user-scalable=no` viewport 设置
- 触摸友好的按钮尺寸
