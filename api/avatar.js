// /api/avatar
// HeyGen 视频数字人：把周老师的文字回复 → 头像开口说话的视频
// 前端传：{ text: "..." }
// 后端返：{ videoUrl: "https://..." } 或 { error, fallback: true }
//
// ⚠️ 已知限制：
// HeyGen 视频生成需要 15–60 秒。Vercel Hobby 套餐 serverless function 10 秒超时——
// 大概率超时失败。解决方案任选一个：
//   1. 升级 Vercel Pro（$20/月）→ maxDuration 可设到 60s
//   2. 用 HeyGen Streaming Avatar（实时，但实现复杂得多）
//   3. 改成异步：先返 video_id，前端轮询 /api/avatar-status
//
// 这个版本采用方案 1：尝试同步等待（最多 50 秒）。如果你在 Hobby 套餐上，
// 大概率前 1-2 次会成功（小心被截断）。看到频繁失败就升级 Pro 或留作后期优化。

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const HEYGEN_AVATAR_ID = process.env.HEYGEN_AVATAR_ID;
const HEYGEN_VOICE_ID = process.env.HEYGEN_VOICE_ID || ''; // 可选，HeyGen 内置 voice

export const config = {
  maxDuration: 60, // Vercel Pro: 60s; Hobby: 实际是 10s（会自动截断）
};

const HEYGEN_API = 'https://api.heygen.com/v2';
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 55000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!HEYGEN_API_KEY || !HEYGEN_AVATAR_ID) {
    // 优雅降级：HeyGen 没配置，前端继续用静态图 + 嘴巴动画
    return res.status(503).json({ error: 'HeyGen 未配置', fallback: true });
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text 字段缺失' });
  }

  // HeyGen 单段限 1500 字
  const safeText = text.length > 1400 ? text.slice(0, 1400) : text;

  try {
    // Step 1: 提交视频生成任务
    const generatePayload = {
      video_inputs: [
        {
          character: {
            type: 'avatar',
            avatar_id: HEYGEN_AVATAR_ID,
            avatar_style: 'normal',
          },
          voice: HEYGEN_VOICE_ID
            ? { type: 'text', input_text: safeText, voice_id: HEYGEN_VOICE_ID }
            : { type: 'text', input_text: safeText, voice_id: '1bd001e7e50f421d891986aad5158bc8' }, // HeyGen 默认普通话女声 fallback
        },
      ],
      dimension: { width: 720, height: 720 },
    };

    const gen = await fetch(`${HEYGEN_API}/video/generate`, {
      method: 'POST',
      headers: {
        'x-api-key': HEYGEN_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(generatePayload),
    });

    if (!gen.ok) {
      const errText = await gen.text();
      console.error('HeyGen 提交失败:', gen.status, errText);
      return res.status(500).json({ error: '视频任务提交失败', detail: errText.slice(0, 200) });
    }

    const genData = await gen.json();
    const videoId = genData.data?.video_id;
    if (!videoId) {
      return res.status(500).json({ error: '没拿到 video_id', detail: JSON.stringify(genData).slice(0, 200) });
    }

    // Step 2: 轮询直到完成或超时
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_WAIT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const status = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
        method: 'GET',
        headers: { 'x-api-key': HEYGEN_API_KEY },
      });

      if (!status.ok) continue;
      const statusData = await status.json();
      const s = statusData.data?.status;

      if (s === 'completed') {
        return res.status(200).json({
          videoUrl: statusData.data.video_url,
          videoId,
        });
      }
      if (s === 'failed') {
        return res.status(500).json({
          error: '视频生成失败',
          detail: statusData.data.error || 'unknown',
          videoId,
        });
      }
      // s === 'processing' or 'pending' → 继续轮询
    }

    // 超时——返回 video_id，前端可以以后再查
    return res.status(202).json({
      pending: true,
      videoId,
      message: '视频还在生成中，本次会话可能用不上了。如果频繁超时请考虑升级 Vercel Pro。',
    });
  } catch (err) {
    console.error('avatar handler 异常:', err);
    return res.status(500).json({ error: err.message || '未知错误' });
  }
}
