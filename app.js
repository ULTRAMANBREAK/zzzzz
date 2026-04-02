// MQTT 配置
const MQTT_CONFIG = {
    host: 'broker.emqx.io',
    port: 8084,
    protocol: 'wss',
    clientId: 'clam_controller_' + Math.random().toString(16).substr(2, 8)
};

const TOPICS = {
    control: 'langou/device001/control',
    status: 'langou/device001/status'
};

// 电机定义（可扩展）
const MOTORS = {
    0x01: { id: 0x01, name: '直流减速电机', defaultDuty: 50 },
    0x02: { id: 0x02, name: '频率控制电机', defaultFreq: 0 }  // 0=1KHz, 100=2KHz
};

// 当前操作的电机 ID（后续多电机可改为动态切换）
const ACTIVE_MOTOR_ID = 0x01;

// 全局状态
let mqttClient = null;
let motorRunning = false;
let currentDuty = MOTORS[ACTIVE_MOTOR_ID].defaultDuty;
let freqMotorRunning = false;
let currentFreqSlider = MOTORS[0x02].defaultFreq;  // 0-100，对应 1000-2000 Hz

// DOM 元素
const elements = {
    connectionStatus: document.getElementById('connectionStatus'),
    statusText: document.querySelector('.status-text'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    statusMessages: document.getElementById('statusMessages'),
    motorControl: document.getElementById('motorControl'),
    dutySlider: document.getElementById('dutySlider'),
    dutyValue: document.getElementById('dutyValue'),
    // 频率控制电机 (0x02)
    freqStartBtn: document.getElementById('freqStartBtn'),
    freqStopBtn: document.getElementById('freqStopBtn'),
    freqMotorControl: document.getElementById('freqMotorControl'),
    freqSlider: document.getElementById('freqSlider'),
    freqValue: document.getElementById('freqValue')
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 同步占空比滑块初始值
    elements.dutySlider.value = currentDuty;
    elements.dutyValue.textContent = currentDuty;
    updateSliderFill(currentDuty);

    // 同步频率滑块初始值
    elements.freqSlider.value = currentFreqSlider;
    elements.freqValue.textContent = sliderToHz(currentFreqSlider);
    updateFreqSliderFill(currentFreqSlider);

    connectMQTT();
    setupEventListeners();
});

// 连接 MQTT
function connectMQTT() {
    updateConnectionStatus('connecting', '连接中...');

    const url = `${MQTT_CONFIG.protocol}://${MQTT_CONFIG.host}:${MQTT_CONFIG.port}/mqtt`;

    mqttClient = mqtt.connect(url, {
        clientId: MQTT_CONFIG.clientId,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 5000
    });

    mqttClient.on('connect', handleConnect);
    mqttClient.on('message', handleMessage);
    mqttClient.on('error', handleError);
    mqttClient.on('offline', handleOffline);
    mqttClient.on('reconnect', handleReconnect);
}

// 处理连接成功
function handleConnect() {
    console.log('MQTT 连接成功');
    updateConnectionStatus('connected', '已连接');

    mqttClient.subscribe(TOPICS.status, { qos: 1 }, (err) => {
        if (err) {
            console.error('订阅失败:', err);
            addStatusMessage('订阅状态主题失败', 'error');
        } else {
            console.log('订阅成功:', TOPICS.status);
            addStatusMessage('已连接到 MQTT 服务器', 'success');
            elements.startBtn.disabled = false;
            elements.stopBtn.disabled = false;
            elements.freqStartBtn.disabled = false;
            elements.freqStopBtn.disabled = false;
        }
    });
}

// 处理接收到的消息
function handleMessage(topic, message) {
    try {
        if (topic === TOPICS.status) {
            const payload = message.toString();
            console.log(`收到消息 [${topic}]:`, payload);

            try {
                const data = JSON.parse(payload);
                addStatusMessage(JSON.stringify(data, null, 2), 'info');
            } catch (e) {
                addStatusMessage(payload, 'info');
            }
        }
    } catch (error) {
        console.error('处理消息失败:', error);
    }
}

// 处理错误
function handleError(error) {
    console.error('MQTT 错误:', error);
    updateConnectionStatus('disconnected', '连接错误');
    addStatusMessage(`连接错误: ${error.message}`, 'error');
    disableButtons();
}

// 处理离线
function handleOffline() {
    console.log('MQTT 离线');
    updateConnectionStatus('disconnected', '已断开');
    addStatusMessage('与服务器断开连接', 'warning');
    disableButtons();
}

// 处理重连
function handleReconnect() {
    console.log('MQTT 重连中...');
    updateConnectionStatus('connecting', '重连中...');
    addStatusMessage('正在重新连接...', 'info');
}

// 更新连接状态显示
function updateConnectionStatus(status, text) {
    elements.connectionStatus.className = `connection-status ${status}`;
    elements.statusText.textContent = text;
}

// 添加状态消息
function addStatusMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `status-item ${type}`;

    const timestamp = new Date().toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const placeholder = elements.statusMessages.querySelector('.placeholder');
    if (placeholder) {
        placeholder.remove();
    }

    messageDiv.innerHTML = `
        <div>${message}</div>
        <span class="timestamp">${timestamp}</span>
    `;

    elements.statusMessages.insertBefore(messageDiv, elements.statusMessages.firstChild);

    const messages = elements.statusMessages.querySelectorAll('.status-item');
    if (messages.length > 20) {
        messages[messages.length - 1].remove();
    }
}

// 发布 MQTT 消息（统一出口）
function publishCommand(cmd, extra = {}) {
    if (!mqttClient || !mqttClient.connected) {
        addStatusMessage('未连接到服务器', 'error');
        return;
    }

    const payload = JSON.stringify({
        cmd,
        motor_id: ACTIVE_MOTOR_ID,
        ...extra
    });

    mqttClient.publish(TOPICS.control, payload, { qos: 1 }, (err) => {
        if (err) {
            console.error('发布消息失败:', err);
            addStatusMessage(`发送指令失败: ${cmd}`, 'error');
        } else {
            console.log(`发布成功 [${TOPICS.control}]:`, payload);
            addStatusMessage(`已发送: ${payload}`, 'success');
        }
    });
}

// 按钮动画反馈
function animateButton(button) {
    button.style.transform = 'scale(0.95)';
    setTimeout(() => {
        button.style.transform = '';
    }, 200);
}

// 更新占空比滑块填充色
function updateSliderFill(value) {
    elements.dutySlider.style.background =
        `linear-gradient(to right, #6366f1 0%, #6366f1 ${value}%, #d1d5db ${value}%, #d1d5db 100%)`;
}

// 更新频率滑块填充色
function updateFreqSliderFill(value) {
    elements.freqSlider.style.background =
        `linear-gradient(to right, #0ea5e9 0%, #0ea5e9 ${value}%, #d1d5db ${value}%, #d1d5db 100%)`;
}

// 频率映射：滑块值 0-100 → 1000-2000 Hz
function sliderToHz(value) {
    return 1000 + value * 10;
}

// 禁用按钮
function disableButtons() {
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = true;
    elements.freqStartBtn.disabled = true;
    elements.freqStopBtn.disabled = true;
}

// 设置事件监听
function setupEventListeners() {
    elements.startBtn.addEventListener('click', () => {
        motorRunning = true;
        elements.motorControl.classList.remove('hidden');
        publishCommand('START', { duty: currentDuty });
        animateButton(elements.startBtn);
    });

    elements.stopBtn.addEventListener('click', () => {
        motorRunning = false;
        elements.motorControl.classList.add('hidden');
        publishCommand('STOP');
        animateButton(elements.stopBtn);
    });

    // 拖动时实时刷新数字显示 + 滑块填充色
    elements.dutySlider.addEventListener('input', () => {
        currentDuty = parseInt(elements.dutySlider.value);
        elements.dutyValue.textContent = currentDuty;
        updateSliderFill(currentDuty);
    });

    // 松开后发送指令（避免频繁推送）
    elements.dutySlider.addEventListener('change', () => {
        currentDuty = parseInt(elements.dutySlider.value);
        publishCommand('SET_DUTY', { duty: currentDuty });
    });

    // 频率控制电机 (0x02)
    elements.freqStartBtn.addEventListener('click', () => {
        freqMotorRunning = true;
        elements.freqMotorControl.classList.remove('hidden');
        publishCommand('START', { motor_id: 0x02, freq: sliderToHz(currentFreqSlider) });
        animateButton(elements.freqStartBtn);
    });

    elements.freqStopBtn.addEventListener('click', () => {
        freqMotorRunning = false;
        elements.freqMotorControl.classList.add('hidden');
        publishCommand('STOP', { motor_id: 0x02 });
        animateButton(elements.freqStopBtn);
    });

    // 拖动时实时刷新频率显示 + 滑块填充色
    elements.freqSlider.addEventListener('input', () => {
        currentFreqSlider = parseInt(elements.freqSlider.value);
        elements.freqValue.textContent = sliderToHz(currentFreqSlider);
        updateFreqSliderFill(currentFreqSlider);
    });

    // 松开后发送频率指令
    elements.freqSlider.addEventListener('change', () => {
        currentFreqSlider = parseInt(elements.freqSlider.value);
        publishCommand('SET_FREQ', { motor_id: 0x02, freq: sliderToHz(currentFreqSlider) });
    });

    // 防止移动端双击缩放
    document.addEventListener('dblclick', (e) => {
        e.preventDefault();
    }, { passive: false });
}

// 页面卸载时断开连接
window.addEventListener('beforeunload', () => {
    if (mqttClient) {
        mqttClient.end();
    }
});
