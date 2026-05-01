/**
 * 周老师数字分身平台 - 前端交互（v2，配合 Vercel 后端）
 *
 * 改动相对原版：
 * 1. 加了 BACKEND_URL —— 默认走相对路径（适合前后端都在 Vercel）
 *    如果你前端继续放 GitHub Pages、后端用 Vercel，把 BACKEND_URL 改成
 *    'https://你的项目.vercel.app' 即可
 * 2. 加了对话历史 conversationHistory —— 每轮发给后端 /api/chat，让周老师有上下文记忆
 * 3. 重置 / 切换身份时会清空 conversationHistory
 */

// ============================================================
// 配置：后端地址
// ============================================================
// 默认 ''（同源，相对路径）—— 前后端都部署在同一个 Vercel 项目时用这个
// 如果前端放 GitHub Pages、后端放 Vercel，改成你的 Vercel URL：
//   const BACKEND_URL = 'https://zhouzhou-avatar.vercel.app';
const BACKEND_URL = '';

const apiUrl = (path) => `${BACKEND_URL}${path}`;

// ============================================================
// DOM 元素
// ============================================================
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const quickQuestions = document.getElementById('quickQuestions');
const statusDot = document.getElementById('statusDot');
const statusTextEl = document.getElementById('statusText');
const avatarStatus = document.getElementById('avatarStatus');
const statusIcon = document.getElementById('statusIcon');
const statusLabel = document.getElementById('statusLabel');
const imageWrapper = document.getElementById('imageWrapper');
const videoWrapper = document.getElementById('videoWrapper');
const avatarVideo = document.getElementById('avatarVideo');

let isSending = false;

// ============================================================
// 对话历史（保留最近 10 轮发给后端）
// ============================================================
let conversationHistory = [];
const MAX_HISTORY = 10;

function pushHistory(role, content) {
  conversationHistory.push({ role, content });
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY);
  }
}

function clearHistory() {
  conversationHistory = [];
}

// ============================================================
// 初始化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  checkHealth();
  autoResizeInput();
  refreshUsage();
});

// 显示当前剩余额度
async function refreshUsage() {
  try {
    const res = await fetch(apiUrl('/api/usage'), { credentials: 'include' });
    const data = await res.json();
    const badge = document.getElementById('usageBadge');
    if (badge) {
      const r = data.remaining;
      badge.textContent = `今日剩余：${r.chat} 次对话`;
      badge.title = `对话 ${r.chat}/${data.limits.chat}　语音 ${r.speak}/${data.limits.speak}　视频 ${r.avatar}/${data.limits.avatar}`;
      if (r.chat <= 3) badge.classList.add('low');
      else badge.classList.remove('low');
    }
  } catch {}
}
window.refreshUsage = refreshUsage;

// 健康检查
async function checkHealth() {
  try {
    const res = await fetch(apiUrl('/api/health'), { credentials: 'include' });
    const data = await res.json();
    const allGood = data.claude || data.elevenlabs || data.heygen;
    statusDot.className = 'status-dot ' + (allGood ? 'online' : 'offline');
    const parts = [];
    if (data.claude) parts.push('AI');
    if (data.elevenlabs) parts.push('语音');
    if (data.heygen) parts.push('视频');
    if (parts.length > 0) {
      statusTextEl.textContent = parts.join(' + ') + ' 在线';
    } else {
      statusTextEl.textContent = '服务未配置';
    }
  } catch (err) {
    statusDot.className = 'status-dot offline';
    statusTextEl.textContent = '连接失败';
  }
}

// 自动调整输入框高度
function autoResizeInput() {
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });
}

// ============================================================
// 发送消息
// ============================================================
async function handleSend() {
  const message = chatInput.value.trim();
  if (!message || isSending) return;

  isSending = true;
  sendBtn.disabled = true;

  // 1. 显示用户消息
  addMessage(message, 'user');
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // 2. 显示打字动画 + 状态
  const typingEl = showTypingIndicator();
  setAvatarStatus('thinking');

  try {
    // 3. 获取文字回复（把对话历史一并发过去，让周老师有上下文）
    const chatRes = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: conversationHistory,
        userRole: window.userRole || 'parent',
      }),
    });
    const chatData = await chatRes.json();

    if (chatRes.status === 429) {
      removeTypingIndicator(typingEl);
      addMessage(`${chatData.error}\n\n${chatData.message || ''}`, 'assistant');
      setAvatarStatus('idle');
      isSending = false;
      sendBtn.disabled = false;
      if (window.refreshUsage) window.refreshUsage();
      return;
    }
    if (!chatRes.ok) throw new Error(chatData.error || '回复失败');

    const reply = chatData.reply;

    // 把这一轮加入历史
    pushHistory('user', message);
    pushHistory('assistant', reply);

    if (window.refreshUsage) window.refreshUsage();

    // 4. 隐藏打字，显示回复
    removeTypingIndicator(typingEl);
    addMessage(reply, 'assistant');

    // 5. 并行：语音合成 + 视频生成
    setAvatarStatus('synthesizing');

    const [audioResult, videoResult] = await Promise.allSettled([
      synthesizeSpeech(reply),
      generateAvatar(reply),
    ]);

    // 6. 播放音频
    if (audioResult.status === 'fulfilled' && audioResult.value) {
      setAvatarStatus('speaking');
      await playAudio(audioResult.value);
    }

    // 7. 播放视频（如果有）
    if (videoResult.status === 'fulfilled' && videoResult.value) {
      showVideo(videoResult.value);
    }
  } catch (err) {
    removeTypingIndicator(typingEl);
    addMessage('抱歉，出了点问题，请稍后再试。', 'assistant');
    console.error('发送错误：', err);
  }

  setAvatarStatus('idle');
  isSending = false;
  sendBtn.disabled = false;
}

// ============================================================
// 消息渲染
// ============================================================
function addMessage(text, role) {
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
  msgDiv.innerHTML = `
    <div class="message-bubble">${escapeHtml(text)}</div>
    <span class="message-time">${time}</span>
  `;

  chatMessages.appendChild(msgDiv);
  scrollToBottom();
}

function showTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'message assistant-message';
  div.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  chatMessages.appendChild(div);
  scrollToBottom();
  return div;
}

function removeTypingIndicator(el) {
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// 头像状态
// ============================================================
function setAvatarStatus(state) {
  statusLabel.className = 'status-label';

  switch (state) {
    case 'thinking':
      statusIcon.innerHTML = '<span class="spin">⏳</span>';
      statusLabel.textContent = '思考中...';
      statusLabel.classList.add('thinking');
      break;
    case 'synthesizing':
      statusIcon.textContent = '🎵';
      statusLabel.textContent = '合成声音中...';
      statusLabel.classList.add('thinking');
      break;
    case 'speaking':
      statusIcon.innerHTML = `
        <span class="wave-animation">
          <span class="wave-bar"></span>
          <span class="wave-bar"></span>
          <span class="wave-bar"></span>
          <span class="wave-bar"></span>
          <span class="wave-bar"></span>
        </span>
      `;
      statusLabel.textContent = '正在说话...';
      statusLabel.classList.add('speaking');
      break;
    case 'generating':
      statusIcon.textContent = '🎬';
      statusLabel.textContent = '生成头像视频... 约15秒';
      statusLabel.classList.add('generating');
      break;
    case 'idle':
    default:
      statusIcon.textContent = '💤';
      statusLabel.textContent = '等待你的问题...';
      break;
  }
}

// ============================================================
// 语音合成（ElevenLabs）
// ============================================================
async function synthesizeSpeech(text) {
  try {
    const res = await fetch(apiUrl('/api/speak'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      console.error('语音合成失败：', res.status);
      return null;
    }

    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error('语音合成错误：', err);
    return null;
  }
}

let currentAudio = null;
let currentPlaybackCleanup = null;
let audioContext = null;
const stopBtn = document.getElementById('stopBtn');

function playAudio(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    currentAudio = audio;
    imageWrapper.classList.add('speaking');
    stopBtn.style.display = 'flex';

    // === 实时声音分析 → 嘴动 ===
    let rafId = null;
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      const source = audioContext.createMediaElementSource(audio);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 2; i < 40; i++) sum += buffer[i];
        const avg = sum / 38 / 255;
        const amount = Math.min(avg * 1.8, 1);
        imageWrapper.style.setProperty('--mouth-open', amount.toFixed(3));
        rafId = requestAnimationFrame(loop);
      };
      loop();
    } catch (err) {
      console.warn('声音分析失败，使用静态动画：', err);
    }

    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      imageWrapper.classList.remove('speaking');
      imageWrapper.style.setProperty('--mouth-open', 0);
      stopBtn.style.display = 'none';
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      currentPlaybackCleanup = null;
      resolve();
    };

    currentPlaybackCleanup = cleanup;
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  });
}

function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  if (currentPlaybackCleanup) {
    currentPlaybackCleanup();
  }
  setAvatarStatus('idle');
}

if (stopBtn) {
  stopBtn.addEventListener('click', stopSpeaking);
}

// ============================================================
// 视频生成（HeyGen，可选）
// ============================================================
async function generateAvatar(text) {
  try {
    setAvatarStatus('generating');

    const res = await fetch(apiUrl('/api/avatar'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (res.status === 503) {
      // HeyGen 没配置 — 优雅降级，啥也不返回，前端继续用静态图+嘴动
      return null;
    }
    if (!res.ok) {
      console.warn('视频生成失败（可能超时，继续用静态图）：', res.status);
      return null;
    }

    const data = await res.json();
    return data.videoUrl || null;
  } catch (err) {
    console.error('视频生成错误：', err);
    return null;
  }
}

function showVideo(url) {
  avatarVideo.src = url;
  imageWrapper.style.display = 'none';
  videoWrapper.style.display = 'block';

  avatarVideo.onended = () => {
    videoWrapper.style.display = 'none';
    imageWrapper.style.display = 'block';
    avatarVideo.src = '';
  };

  avatarVideo.onerror = () => {
    videoWrapper.style.display = 'none';
    imageWrapper.style.display = 'block';
  };

  avatarVideo.play().catch(() => {
    videoWrapper.style.display = 'none';
    imageWrapper.style.display = 'block';
  });
}

// ============================================================
// 发送按钮 & Enter
// ============================================================
sendBtn.addEventListener('click', handleSend);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// 快速问题按钮（事件委托，因为按钮会被 immersive.html 里的代码动态替换）
quickQuestions.addEventListener('click', (e) => {
  const btn = e.target.closest('.quick-btn');
  if (btn && btn.dataset.q) {
    chatInput.value = btn.dataset.q;
    handleSend();
  }
});

// ============================================================
// 重置（切换身份时被调用）
// ============================================================
const _origFetch = window.fetch;
window.fetch = function (url, opts = {}) {
  // 拦截：调到 /api/reset 时清空本地历史
  if (typeof url === 'string' && (url === '/api/reset' || url.endsWith('/api/reset'))) {
    clearHistory();
  }
  return _origFetch(url, opts);
};

// 暴露给调试用
window.__zhouxlaoshi = { conversationHistory, clearHistory };
