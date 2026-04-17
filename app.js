// ── 登录逻辑 ──
(function () {
    const CREDENTIALS = { user: 'lazydog', pass: 'qwe44944' };
    const overlay  = document.getElementById('loginOverlay');
    const userInput = document.getElementById('loginUser');
    const passInput = document.getElementById('loginPass');
    const loginBtn  = document.getElementById('loginBtn');
    const errorBox  = document.getElementById('loginError');

    // 已登录则直接隐藏遮罩
    if (sessionStorage.getItem('auth') === '1') {
        overlay.classList.add('hidden');
        return;
    }

    function attempt() {
        const u = userInput.value.trim();
        const p = passInput.value;
        if (u === CREDENTIALS.user && p === CREDENTIALS.pass) {
            sessionStorage.setItem('auth', '1');
            overlay.style.transition = 'opacity 0.3s';
            overlay.style.opacity = '0';
            setTimeout(() => overlay.classList.add('hidden'), 300);
        } else {
            errorBox.classList.remove('hidden');
            passInput.value = '';
            passInput.focus();
            userInput.style.borderColor = '#ef4444';
            passInput.style.borderColor = '#ef4444';
            setTimeout(() => {
                userInput.style.borderColor = '';
                passInput.style.borderColor = '';
            }, 1200);
        }
    }

    loginBtn.addEventListener('click', attempt);
    passInput.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
    userInput.addEventListener('keydown', e => { if (e.key === 'Enter') passInput.focus(); });

    // 输入时隐藏错误提示
    [userInput, passInput].forEach(el =>
        el.addEventListener('input', () => errorBox.classList.add('hidden'))
    );
})();

// MQTT 配置
const MQTT_CONFIG = {
    host: 'broker.emqx.io',
    port: 8084,
    protocol: 'wss',
    clientId: 'clam_controller_' + Math.random().toString(16).substr(2, 8)
};

const TOPICS = {
    control:    'langou/device001/control',
    status:     'langou/device001/status',
    camStatus:  'langou/cam/status',
    stm32Status: 'langou/device001/stm32status'
};

// 电机定义（可扩展）
const MOTORS = {
    0x01: { id: 0x01, name: '直流减速电机', defaultDuty: 20 },
    0x02: { id: 0x02, name: '86步进电机', defaultFreq: 1000 }  // Hz，范围 1000-140000
};

// 当前操作的电机 ID（后续多电机可改为动态切换）
const ACTIVE_MOTOR_ID = 0x01;

// 全局状态
let mqttClient = null;
let machineRunning = false;
let currentDuty = MOTORS[ACTIVE_MOTOR_ID].defaultDuty;
let currentFreq = MOTORS[0x02].defaultFreq;  // Hz，范围 1000-140000，步长 1000

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
    freqMotorControl: document.getElementById('freqMotorControl'),
    freqDecBtn: document.getElementById('freqDecBtn'),
    freqIncBtn: document.getElementById('freqIncBtn'),
    freqValue: document.getElementById('freqValue'),
    stm32Messages: document.getElementById('stm32Messages')
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 同步占空比滑块初始值
    elements.dutySlider.value = currentDuty;
    elements.dutyValue.textContent = currentDuty;
    updateSliderFill(currentDuty);

    // 同步频率显示初始值
    elements.freqValue.textContent = currentFreq;

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
        }
    });

    mqttClient.subscribe(TOPICS.camStatus, { qos: 1 }, (err) => {
        if (err) {
            console.error('订阅摄像头主题失败:', err);
        } else {
            console.log('订阅成功:', TOPICS.camStatus);
        }
    });

    mqttClient.subscribe(TOPICS.stm32Status, { qos: 1 }, (err) => {
        if (err) {
            console.error('订阅 STM32 主题失败:', err);
        } else {
            console.log('订阅成功:', TOPICS.stm32Status);
        }
    });
}

// 处理接收到的消息
function handleMessage(topic, message) {
    try {
        const payload = message.toString();
        console.log(`收到消息 [${topic}]:`, payload);

        if (topic === TOPICS.status) {
            try {
                const data = JSON.parse(payload);
                addStatusMessage(JSON.stringify(data, null, 2), 'info');
            } catch (e) {
                addStatusMessage(payload, 'info');
            }
        } else if (topic === TOPICS.stm32Status) {
            addStm32Message(payload);
        } else if (topic === TOPICS.camStatus) {
            try {
                const data = JSON.parse(payload);
                if (data.stream_url) {
                    document.getElementById('mjpeg-stream').src = data.stream_url;
                    console.log('检测到摄像头新地址：', data.stream_url);
                }
            } catch (e) {
                console.warn('摄像头状态消息解析失败:', e);
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

// 添加 STM32 状态消息
function addStm32Message(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'status-item info';

    const timestamp = new Date().toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const placeholder = elements.stm32Messages.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    messageDiv.innerHTML = `
        <div>${message}</div>
        <span class="timestamp">${timestamp}</span>
    `;

    elements.stm32Messages.insertBefore(messageDiv, elements.stm32Messages.firstChild);

    const messages = elements.stm32Messages.querySelectorAll('.status-item');
    if (messages.length > 20) {
        messages[messages.length - 1].remove();
    }
}

// 发布 MQTT 消息（统一出口）
// extra 中可包含 motor_id；若不传则指令为机器级别（无 motor_id）
function publishCommand(cmd, extra = {}) {
    if (!mqttClient || !mqttClient.connected) {
        addStatusMessage('未连接到服务器', 'error');
        return;
    }

    const payload = JSON.stringify({ cmd, ...extra });

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

// 频率范围约束
const FREQ_MIN = 1000;
const FREQ_MAX = 140000;
const FREQ_STEP = 1000;

// 禁用按钮
function disableButtons() {
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = true;
}

// 设置事件监听
function setupEventListeners() {
    // ── 启动机器：全局 START，展开双电机控制面板，重置数值为默认值 ──
    elements.startBtn.addEventListener('click', () => {
        machineRunning = true;

        // 重置占空比为默认值
        currentDuty = MOTORS[ACTIVE_MOTOR_ID].defaultDuty;
        elements.dutySlider.value = currentDuty;
        elements.dutyValue.textContent = currentDuty;
        updateSliderFill(currentDuty);

        // 重置频率为默认值
        currentFreq = MOTORS[0x02].defaultFreq;
        elements.freqValue.textContent = currentFreq;

        elements.motorControl.classList.remove('hidden');
        elements.freqMotorControl.classList.remove('hidden');
        publishCommand('START');
        publishCommand('SET_DUTY', { motor_id: 0x01, duty: currentDuty });
        animateButton(elements.startBtn);
    });

    // ── 停止机器：全局 STOP，收起双电机控制面板 ──
    elements.stopBtn.addEventListener('click', () => {
        machineRunning = false;
        elements.motorControl.classList.add('hidden');
        elements.freqMotorControl.classList.add('hidden');
        publishCommand('STOP');
        animateButton(elements.stopBtn);
    });

    // 电机1 占空比：拖动时刷新显示，松开后发送指令
    elements.dutySlider.addEventListener('input', () => {
        currentDuty = parseInt(elements.dutySlider.value);
        elements.dutyValue.textContent = currentDuty;
        updateSliderFill(currentDuty);
    });
    elements.dutySlider.addEventListener('change', () => {
        currentDuty = parseInt(elements.dutySlider.value);
        publishCommand('SET_DUTY', { motor_id: 0x01, duty: currentDuty });
    });

    // 电机2 频率：加减按钮，每次 ±1KHz
    elements.freqDecBtn.addEventListener('click', () => {
        if (currentFreq - FREQ_STEP < FREQ_MIN) return;
        currentFreq -= FREQ_STEP;
        elements.freqValue.textContent = currentFreq;
        publishCommand('SET_FREQ', { motor_id: 0x02, freq: currentFreq });
    });
    elements.freqIncBtn.addEventListener('click', () => {
        if (currentFreq + FREQ_STEP > FREQ_MAX) return;
        currentFreq += FREQ_STEP;
        elements.freqValue.textContent = currentFreq;
        publishCommand('SET_FREQ', { motor_id: 0x02, freq: currentFreq });
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

// ── AI 助手模块 ──
const AI_CONFIG = {
    baseUrlKey: 'ai_base_url',
    apiKeyKey:  'ai_api_key'
};

const aiSettingsBtn  = document.getElementById('aiSettingsBtn');
const aiSettings     = document.getElementById('aiSettings');
const aiBaseUrlInput = document.getElementById('aiBaseUrl');
const aiApiKeyInput  = document.getElementById('aiApiKey');
const aiSaveBtn      = document.getElementById('aiSaveBtn');
const aiSaveTip      = document.getElementById('aiSaveTip');
const aiAnalyzeBtn   = document.getElementById('aiAnalyzeBtn');
const aiAutoToggle   = document.getElementById('aiAutoToggle');
const aiIntervalSel  = document.getElementById('aiInterval');
const aiResultArea   = document.getElementById('aiResultArea');

// 初始化：从 localStorage 读取已保存配置
(function initAiConfig() {
    const savedUrl = localStorage.getItem(AI_CONFIG.baseUrlKey);
    const savedKey = localStorage.getItem(AI_CONFIG.apiKeyKey);
    if (savedUrl) aiBaseUrlInput.value = savedUrl;
    if (savedKey) aiApiKeyInput.value  = savedKey;
})();

// 设置区折叠/展开
aiSettingsBtn.addEventListener('click', () => {
    aiSettings.classList.toggle('hidden');
});

// 保存配置
aiSaveBtn.addEventListener('click', () => {
    const url = aiBaseUrlInput.value.trim().replace(/\/$/, ''); // 去尾部斜杠
    const key = aiApiKeyInput.value.trim();
    localStorage.setItem(AI_CONFIG.baseUrlKey, url);
    localStorage.setItem(AI_CONFIG.apiKeyKey,  key);
    aiSaveTip.classList.remove('hidden');
    setTimeout(() => aiSaveTip.classList.add('hidden'), 2000);
});

/**
 * 截取当前 MJPEG 帧，返回纯 base64 字符串（JPEG）
 * 若跨域污染则抛出错误
 */
function captureFrame() {
    const img = document.getElementById('mjpeg-stream');
    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth  || 640;
    canvas.height = img.naturalHeight || 480;
    canvas.getContext('2d').drawImage(img, 0, 0);
    try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        return dataUrl.split(',')[1]; // 去掉 "data:image/jpeg;base64," 前缀
    } catch (e) {
        throw new Error('Canvas 跨域污染：请检查 ESP32 是否已返回 Access-Control-Allow-Origin 头');
    }
}

function showAiResult(html) {
    aiResultArea.innerHTML = html;
}

let aiAnalyzing = false; // 防止并发

async function analyzeClam() {
    if (aiAnalyzing) return;

    const baseUrl = localStorage.getItem(AI_CONFIG.baseUrlKey);
    const apiKey  = localStorage.getItem(AI_CONFIG.apiKeyKey);

    if (!baseUrl || !apiKey) {
        showAiResult('<div class="ai-result-error">请先点击 ⚙ 填写中转站 URL 和 API Key</div>');
        aiSettings.classList.remove('hidden');
        return;
    }

    let base64;
    try {
        base64 = captureFrame();
    } catch (e) {
        showAiResult(`<div class="ai-result-error">${e.message}</div>`);
        return;
    }

    aiAnalyzing = true;
    aiAnalyzeBtn.disabled = true;
    showAiResult('<div class="ai-analyzing">分析中，请稍候...</div>');

    const currentFreq = parseInt(document.getElementById('freqValue').textContent, 10) || 1000;
    const prompt = `你是蛤蜊破碎设备的专业运维工程师。请分析图像中蛤蜊的破碎状态。\n当前参数：86步进电机频率 ${currentFreq} Hz（范围 1000~140000 Hz）。\n\n请严格按以下JSON格式回复（不要有其他文字）：\n{"analysis":"对破碎状态的简短描述（50字内）","freq":推荐频率数字,"needAdjust":true或false}`;

    try {
        const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 300,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
                        { type: 'text', text: prompt }
                    ]
                }]
            })
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`API 错误 ${resp.status}: ${errText.substring(0, 100)}`);
        }

        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';

        let parsed;
        try {
            const match = content.match(/\{[\s\S]*?\}/);
            parsed = JSON.parse(match ? match[0] : content);
        } catch {
            showAiResult(`<div class="ai-result-analysis">${content}</div>`);
            return;
        }

        const { analysis = '', freq, needAdjust } = parsed;
        let html = `<div class="ai-result-analysis">${analysis}</div>`;
        if (needAdjust && freq) {
            html += `<div class="ai-result-freq">📡 推荐频率：${freq} Hz</div>`;
        } else {
            html += `<div class="ai-result-ok">✓ 当前频率参数良好</div>`;
        }
        showAiResult(html);

    } catch (e) {
        showAiResult(`<div class="ai-result-error">请求失败：${e.message}</div>`);
    } finally {
        aiAnalyzing = false;
        aiAnalyzeBtn.disabled = false;
    }
}

aiAnalyzeBtn.addEventListener('click', analyzeClam);

let aiTimer = null;

aiAutoToggle.addEventListener('change', () => {
    if (aiAutoToggle.checked) {
        const seconds = parseInt(aiIntervalSel.value, 10);
        aiTimer = setInterval(analyzeClam, seconds * 1000);
        // 立即触发一次
        analyzeClam();
    } else {
        clearInterval(aiTimer);
        aiTimer = null;
    }
});

// 切换间隔时：若自动模式已开启，重置定时器
aiIntervalSel.addEventListener('change', () => {
    if (!aiAutoToggle.checked) return;
    clearInterval(aiTimer);
    const seconds = parseInt(aiIntervalSel.value, 10);
    aiTimer = setInterval(analyzeClam, seconds * 1000);
});
