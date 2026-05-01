// /api/health
// 探活：返回 3 个上游服务是否配置了 API key
// GET 即可，无副作用

export default function handler(req, res) {
  // CORS — 允许 GitHub Pages 跨域调用（如果你把前端留在 GitHub Pages 的话）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(200).json({
    claude: !!process.env.ANTHROPIC_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    heygen: !!(process.env.HEYGEN_API_KEY && process.env.HEYGEN_AVATAR_ID),
  });
}
