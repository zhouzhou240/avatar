// /api/speak
// ElevenLabs TTS：把周老师的文字回复转成 mp3 语音
// 前端传：{ text: "..." }
// 后端返：mp3 音频流（Content-Type: audio/mpeg）

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // 默认 Rachel
const MODEL_ID = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5'; // 多语言、便宜、快

export const config = {
  // ElevenLabs 流式响应。Vercel Hobby 套餐 10 秒超时，对短回复够用。
  // 如果文本很长可能超时——周老师 prompt 已限制 600 tokens，应该没问题。
  maxDuration: 10,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'ELEVENLABS_API_KEY 未配置' });
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text 字段缺失' });
  }

  // ElevenLabs 单次免费版限 5000 字符；周老师回复短，500 字内绰绰有余
  const safeText = text.length > 1500 ? text.slice(0, 1500) : text;

  try {
    const elevenResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'content-type': 'application/json',
          'accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: safeText,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!elevenResp.ok) {
      const errText = await elevenResp.text();
      console.error('ElevenLabs 错误:', elevenResp.status, errText);
      return res.status(500).json({ error: 'TTS 失败', detail: errText.slice(0, 200) });
    }

    // 把 mp3 二进制流返给前端
    const audioBuffer = await elevenResp.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.status(200).send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error('speak handler 异常:', err);
    return res.status(500).json({ error: err.message || '未知错误' });
  }
}
