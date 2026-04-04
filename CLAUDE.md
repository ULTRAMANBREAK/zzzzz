# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

纯前端 MQTT IoT 控制台，通过浏览器远程控制"蛤蜊破碎设备"（直流减速电机 + 86步进电机），并通过 ESP32 HTTP 视频流实时监控摄像头画面。

### 技术栈
- 纯前端: HTML + CSS + Vanilla JavaScript (无构建工具)
- MQTT 通信: MQTT.js v5.3.5 (CDN)
- MQTT Broker: `wss://broker.emqx.io:8084/mqtt`
- 视频流: ESP32 HTTP stream（默认地址 `http://192.168.5.123/stream`，可经 MQTT 动态更新）

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
- **摄像头状态** (`langou/cam/status`): 订阅摄像头状态，收到 `{ "stream_url": "..." }` 时动态替换 `#mjpeg-stream` 的 `src`

### 控制指令格式 (发布到 `control`)

全局机器指令**不含** `motor_id`，电机级指令需指定：

```json
{ "cmd": "START" }
{ "cmd": "STOP"  }

{ "cmd": "SET_DUTY", "motor_id": 1, "duty": 75 }
{ "cmd": "SET_FREQ", "motor_id": 2, "freq": 1500 }
```

- 点击"启动"/"停止"发送无 `motor_id` 的机器级 `START`/`STOP`，**同时**展开/收起两个电机控制面板。
- `SET_DUTY` / `SET_FREQ` 在滑块 `change` 事件（松开后）触发；`input` 事件（拖动中）只更新 UI。
- 频率映射：滑块值 `v` (0–100) → `freq = 1000 + v * 70`（Hz），范围 1000–8000 Hz。

### 状态消息 (从 `status` 接收)
- 自动尝试解析 JSON，失败则显示原始文本

## 代码架构要点

### 电机抽象层 (app.js:15-22)

```js
const MOTORS = {
    0x01: { id: 0x01, name: '直流减速电机', defaultDuty: 50 },
    0x02: { id: 0x02, name: '86步进电机',   defaultFreq: 0 }  // 0=1KHz, 100=8KHz
};
const ACTIVE_MOTOR_ID = 0x01;
```

`publishCommand(cmd, extra)` 是唯一的 MQTT 发布出口。`extra` 中传入 `motor_id` 可覆盖默认行为（用于 0x02 频率指令）；不传则为机器级指令。

### 双电机控制面板

`#motorControl`（电机1，占空比）和 `#freqMotorControl`（电机2，频率）默认 `.hidden`，点击"启动"后同时显示，点击"停止"后同时隐藏。

### MQTT 连接生命周期
- `connect` → 订阅 status + camStatus 主题，启用按钮
- `offline` / `error` → 禁用按钮，显示状态
- `reconnect` → 自动重连（5 秒间隔）

### 状态消息队列
最多保留 20 条，新消息插入头部。类型：`success` / `error` / `info` / `warning`，通过左边框颜色区分。

## 配置修改

修改连接配置需同时更新两处：
1. `app.js` 顶部的 `MQTT_CONFIG` 和 `TOPICS` 常量
2. `index.html` 底部 `.info-panel` 的显示文本

## 移动端支持

- 布局最大宽度 480px，居中显示，针对手机全屏优化
- `viewport` 禁用缩放 (`user-scalable=no`)
- `env(safe-area-inset-*)` 适配刘海/底部手势条
- 按钮使用 ripple 动画 (`::before` 伪元素) 替代默认 tap 高亮
