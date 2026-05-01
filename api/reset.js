// /api/reset
// 重置会话。后端无状态，所以直接返 200；前端的对话历史在前端 JS 内存里，
// app.js 改造后会在调用 /api/reset 后清空本地 history 数组。

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(200).json({ ok: true });
}
