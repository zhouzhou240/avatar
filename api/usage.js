// /api/usage
// 简单的"今日剩余额度"显示。MVP 阶段：不真的限制，仅展示固定上限+假装无限。
// 等有真实滥用风险了，再换成 Vercel KV / Upstash Redis 做真正的限流。

const LIMITS = {
  chat: parseInt(process.env.LIMIT_CHAT || '50', 10),
  speak: parseInt(process.env.LIMIT_SPEAK || '50', 10),
  avatar: parseInt(process.env.LIMIT_AVATAR || '5', 10),
};

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // MVP：展示固定剩余值。等用户量起来再做真实计量。
  return res.status(200).json({
    limits: LIMITS,
    remaining: {
      chat: LIMITS.chat,
      speak: LIMITS.speak,
      avatar: LIMITS.avatar,
    },
  });
}
