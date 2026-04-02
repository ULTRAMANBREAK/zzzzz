# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

纯前端 MQTT IoT 控制台，通过浏览器远程控制"蛤蜊破碎设备"（直流减速电机），并通过 ESP32 HTTP 视频流实时监控摄像头画面。

### 技术栈
- 纯前端: HTML + CSS + Vanilla JavaScript (无构建工具)
- MQTT 通信: MQTT.js v5.3.5 (CDN)
- MQTT Broker: `wss://broker.emqx.io:8084/mqtt`
- 视频流: ESP32 HTTP stream (`http://192.168.5.123/stream`)

## 如何运行

直接在浏览器中打开 `index.html`，或通过简单的 HTTP 服务器:

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve
```

## MQTT 架构

### 主题结构
- **控制主题** (`langou/device001/control`): 发布控制指令 (QoS 1)
- **状态主题** (`langou/device001/status`): 订阅设备状态消息 (QoS 1)

摄像头**不经过 MQTT**，直接用 `<img src="http://192.168.5.123/stream">` 展示 ESP32 视频流。

### 控制指令格式 (发布到 `control`)

所有指令均包含 `motor_id` 字段（当前固定为 `0x01`）：

```json
{ "cmd": "START",    "motor_id": 1, "duty": 50 }
{ "cmd": "STOP",     "motor_id": 1 }
{ "cmd": "SET_DUTY", "motor_id": 1, "duty": 75 }

{ "cmd": "START",    "motor_id": 2, "freq": 1000 }
{ "cmd": "STOP",     "motor_id": 2 }
{ "cmd": "SET_FREQ", "motor_id": 2, "freq": 1500 }
```

- `SET_DUTY` / `SET_FREQ` 均在滑块 `change` 事件（松开后）触发；`input` 事件（拖动中）只更新 UI，不发送 MQTT。
- 频率映射：滑块值 `v` → `freq = 1000 + v * 10`（Hz），范围 1000–2000 Hz。

### 状态消息 (从 `status` 接收)
- 可以是 JSON 对象或纯文本
- 自动尝试解析 JSON，失败则显示原始文本

## 代码架构要点

### 电机抽象层 (app.js:15-22)

```js
const MOTORS = {
    0x01: { id: 0x01, name: '直流减速电机', defaultDuty: 50 },
    0x02: { id: 0x02, name: '频率控制电机', defaultFreq: 0 }  // 0=1KHz
};
const ACTIVE_MOTOR_ID = 0x01;
```

`publishCommand(cmd, extra)` 是唯一的 MQTT 发布出口，默认注入 `ACTIVE_MOTOR_ID`；在 `extra` 中传入 `motor_id` 可覆盖（用于 0x02 频率电机指令）。

### 电机占空比控制面板

`#motorControl` 面板默认 `.hidden`，点击"启动"后显示，点击"停止"后重新隐藏。滑块范围 0-100，对应占空比百分比。

### MQTT 连接生命周期
- `connect` → 订阅 status 主题，启用按钮
- `offline` / `error` → 禁用按钮，显示状态
- `reconnect` → 自动重连 (5 秒间隔)

### 状态消息队列
最多保留 20 条，新消息插入头部，超出时移除尾部。类型：`success` / `error` / `info` / `warning`，通过左边框颜色区分。

## 配置修改

修改连接配置需同时更新两处：
1. `app.js` 顶部的 `MQTT_CONFIG` 和 `TOPICS` 常量
2. `index.html` 底部 `.info-panel` 的显示文本

## 移动端支持

- 布局最大宽度 480px，居中显示，针对手机全屏优化
- `viewport` 禁用缩放 (`user-scalable=no`)
- `env(safe-area-inset-*)` 适配刘海/底部手势条
- 按钮使用 ripple 动画 (`::before` 伪元素) 替代默认 tap 高亮
