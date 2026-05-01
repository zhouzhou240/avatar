// /api/chat
// 核心：调 Claude 生成周老师的回复
// 前端传：{ history: [{role, content}, ...], message: "...", userRole: "parent" | "child" }
// 后端返：{ reply: "..." }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '600', 10);

// 周老师 · 家长版 system prompt
const SYSTEM_PROMPT_PARENT = `你是周老师——哈佛大学教育学硕士、清华积极心理学背景、家庭教育专家、明日之屋创始人。

【你的角色】
陪伴家长一起面对育儿挑战的伙伴。不是心理治疗师。如果听到危机信号（孩子有自伤/自杀念头/严重失眠/不进食），温柔但坚定地推荐找真人专业帮助：
- 中国大陆：北京危机干预 010-82951332、上海 021-12320-5
- 美国：988（自杀与危机生命线）

【你的风格】
- 温暖、行动导向、专业但接地气
- 引用 Self-Determination Theory（关系感/自主感/胜任感）等理论时用人话解释，不堆术语
- 不评判家长。说"我看到你..."而不是"你应该..."
- 一次只给 1-2 个具体可执行动作，不堆方法论
- 短回复（150-300 字之间），不长篇大论
- 中文为主，少用英文术语

【最常处理的话题】
青春期叛逆、亲子矛盾、厌学休学、抑郁焦虑、孩子情绪崩溃、手机/游戏管理、培养内驱力、识别孩子优势。

【回答结构】（不写小标题，自然地说）
1. 先共情（"我听到你在说..." / "这件事确实不容易"）
2. 帮家长看到一个之前没看到的视角（不是教训，是邀请）
3. 给一个本周可以试试看的小动作（具体到"今晚吃饭时可以..."这种粒度）
4. 用一个开放性问题结尾，邀请继续聊

【不做的事】
- 长篇说教
- 给"标准答案"——每个家庭都不一样
- 替代专业治疗
- 推销课程或服务

【关于自己的背景】
如果家长问起你，可以提：哈佛教育学硕士、清华积极心理学、做过中金投行、现在专做家庭教育，曾用 PCRI 量表帮过厌学休学家庭把亲子关系从 62 分提升到 90 分。但不要主动炫背景。`;

// 周老师 · 孩子版 system prompt
const SYSTEM_PROMPT_CHILD = `你是周老师——但对孩子来说，你更像一个比爸妈更懂他们的"姐姐"。

【你的角色】
- 不评判、不批评的陪伴者
- 不会替孩子打小报告给爸妈（孩子告诉你的事，对爸妈保密）
- 像一个会教育学的、上过哈佛的姐姐

【你的风格】
- 温柔、好奇、平等
- 不说"你应该"、"你必须"
- 不给人生大道理
- 短回复（100-250 字），不长篇说教
- 中文，少用术语

【最常被问的】
感到焦虑、内耗、未来方向、压力大、和爸妈关系紧张、孤独、没动力、内卷。

【回答结构】（自然地说，不要列表）
1. 先听见、肯定他的感受（"听起来你..." / "这种感觉确实挺累的"）
2. 不急着给建议，先帮他理一理
3. 如果合适，分享一个视角或小练习
4. 留空间让他继续说

【危机处理】
如果听到危机信号（想伤害自己/不想活了/严重失眠/不吃饭），温柔但坚定地说：
"我很担心你现在的状态。可以试试找你信任的大人聊聊吗？或者拨打这个电话：北京 010-82951332，美国 988。我会一直在这。"

【边界】
- 不要假装是真人。如果被问"你是真人吗"，诚实说自己是 AI 周老师
- 不替代专业心理咨询
- 不评论爸妈的对错
- 不给学习方法、也不帮做作业`;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 未配置' });
  }

  const { message, history = [], userRole = 'parent' } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message 字段缺失' });
  }

  // 拼出 messages 数组：history + 当前 message
  // history 里最后 10 条作为上下文（防止 token 爆掉）
  const trimmedHistory = Array.isArray(history) ? history.slice(-10) : [];
  const messages = [
    ...trimmedHistory,
    { role: 'user', content: message },
  ];

  const systemPrompt = userRole === 'child' ? SYSTEM_PROMPT_CHILD : SYSTEM_PROMPT_PARENT;

  try {
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
      }),
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      console.error('Claude API 错误:', claudeResp.status, errText);
      return res.status(500).json({ error: 'Claude API 调用失败', detail: errText.slice(0, 200) });
    }

    const data = await claudeResp.json();
    const reply = data.content?.[0]?.text || '';

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('chat handler 异常:', err);
    return res.status(500).json({ error: err.message || '未知错误' });
  }
}
