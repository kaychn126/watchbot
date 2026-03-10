const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { format } = require('date-fns');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// 配置
const CONFIG = {
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  captureInterval: 5000,
  screenshotDir: path.join(__dirname, '../screenshots'),
  dbPath: path.join(__dirname, '../data/watchbot.db'),
};

// 确保数据目录存在
const dataDir = path.dirname(CONFIG.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据库
const db = new Database(CONFIG.dbPath);

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS work_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    activity TEXT NOT NULL,
    productivity INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    screenshot_file TEXT,
    detail TEXT,
    focus_score INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS daily_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    summary TEXT,
    total_hours REAL,
    main_activities TEXT,
    suggestions TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_timestamp ON work_records(timestamp);
  CREATE INDEX IF NOT EXISTS idx_date ON daily_summary(date);
`);

// 设置默认设置
const defaultSettings = {
  captureInterval: 5000,
  monitoring: false,
};
for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

// 截屏库加载
let screenshot = null;
if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
  try {
    screenshot = require('screenshot-desktop');
    console.log('✓ screenshot-desktop 已加载');
  } catch (e) { }
} else {
  console.log('ℹ 无图形环境，使用模拟截屏');
}

// OpenAI
let OpenAI = null;
try { OpenAI = require('openai'); } catch (e) { }

let openai = null;
if (CONFIG.openaiApiKey && OpenAI) {
  openai = new OpenAI({ apiKey: CONFIG.openaiApiKey });
}

// 确保截图目录存在
if (!fs.existsSync(CONFIG.screenshotDir)) {
  fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
}

let monitorInterval = null;

// 增强的 AI 分析 Prompt
const ANALYSIS_PROMPT = `你是一个专业的工作效率分析师。请仔细分析用户当前屏幕截图，评估工作状态。

请从以下维度进行分析：

1. **当前活动 (activity)**: 描述用户正在做什么
   - 例如：编写代码、撰写文档、浏览技术文档、参加视频会议、处理邮件、调试bug、设计UI等
   - 如果是编码，说明具体在哪个项目/模块

2. **工作状态 (status)**: 总体评估
   - 高效工作：专注且有产出
   - 普通工作：正常但可能有轻微分心
   - 严重分心：频繁切换应用或做与工作无关的事
   - 休息中：确实在休息

3. **专注度评分 (focus_score)**: 0-100
   - 基于：任务连贯性、切换频率、工作节奏

4. **详细描述 (detail)**: 用15-30字描述当前工作
   - 需要说明：具体在做什么、持续了多久、有什么产出
   - 例如："正在编写用户认证模块，已持续45分钟"
   - 例如："整理技术文档，这是今天的第3篇"
   - 例如："一个小时切换了5次应用，需要更专注"

5. **效率分数 (productivity)**: 0-100
   - 综合考虑专注度、任务重要性、产出质量

请返回以下JSON格式（只返回JSON，不要其他内容）：
{
  "status": "高效工作|普通工作|严重分心|休息中",
  "activity": "具体在做什么",
  "focus_score": 专注度0-100,
  "detail": "15-30字的详细描述，包含持续时间、产出、建议等",
  "productivity": 效率0-100
}

关键要求：
- detail 字段必须有具体时间描述（如"已持续X分钟"）
- 如果看到多任务切换，在detail中指出
- 给出具体的改进建议（如"建议关闭社交媒体"）`;

// AI 分析
async function analyzeScreenshot(imagePath) {
  if (!openai || !fs.existsSync(imagePath)) {
    return generateMockAnalysis();
  }
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: ANALYSIS_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
        ]
      }],
      max_tokens: 500,
    });
    
    const content = response.choices[0].message.content;
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const result = JSON.parse(match[0]);
      // 确保有 detail 字段
      if (!result.detail) {
        result.detail = `${result.activity}，状态: ${result.status}`;
      }
      if (!result.focus_score) {
        result.focus_score = result.productivity;
      }
      return result;
    }
    return generateMockAnalysis();
  } catch (error) {
    console.error('AI分析失败:', error.message);
    return generateMockAnalysis();
  }
}

// 生成模拟分析
function generateMockAnalysis() {
  const activities = [
    { activity: 'Coding 🖥️', detail: '正在编写核心业务逻辑，已持续30分钟' },
    { activity: '文档处理 📝', detail: '整理技术文档，这是今天的第2篇' },
    { activity: '会议 💼', detail: '参加需求评审会议，已进行45分钟' },
    { activity: '浏览器浏览 🌐', detail: '查阅技术文档和StackOverflow' },
    { activity: '邮件处理 📧', detail: '处理工作邮件和Slack消息' },
    { activity: '休息 ☕', detail: '短暂休息，放松眼睛' },
  ];
  
  const statuses = ['高效工作', '普通工作', '严重分心', '休息中'];
  const rand = Math.random();
  const status = rand < 0.6 ? statuses[1] : (rand < 0.9 ? statuses[0] : statuses[2]);
  
  const selected = activities[Math.floor(Math.random() * activities.length)];
  
  return {
    status,
    activity: selected.activity,
    detail: selected.detail,
    focus_score: Math.floor(Math.random() * 30) + 70,
    productivity: Math.floor(Math.random() * 30) + 70,
  };
}

// 生成优化建议（基于历史数据）
function generateInsights() {
  const records = db.prepare('SELECT * FROM work_records ORDER BY timestamp DESC LIMIT 20').all();
  
  if (records.length < 5) {
    return {
      overall: '数据收集中，请继续工作...',
      suggestions: ['系统正在学习您的工作模式'],
      trend: 'stable'
    };
  }

  // 计算各项指标
  const avgProductivity = Math.round(records.reduce((sum, r) => sum + r.productivity, 0) / records.length);
  const avgFocus = Math.round(records.reduce((sum, r) => sum + (r.focus_score || r.productivity), 0) / records.length);
  
  // 分析活动分布
  const activityCount = {};
  records.forEach(r => {
    const act = r.activity.replace(/[🖥️📝💼🌐📧☕]/g, '').trim();
    activityCount[act] = (activityCount[act] || 0) + 1;
  });
  const topActivity = Object.entries(activityCount).sort((a, b) => b[1] - a[1])[0];
  
  // 检测专注度问题
  const lowFocusCount = records.filter(r => (r.focus_score || r.productivity) < 70).length;
  const hasFocusIssue = lowFocusCount > records.length * 0.3;
  
  // 时间段分析
  const hour = new Date().getHours();
  
  const insights = {
    overall: '',
    suggestions: [],
    trend: avgProductivity > 80 ? 'up' : avgProductivity > 60 ? 'stable' : 'down',
    details: {
      avgProductivity,
      avgFocus,
      topActivity: topActivity ? topActivity[0] : '未知',
      workDuration: Math.round((Date.now() - new Date(records[records.length-1]?.timestamp).getTime()) / 3600000 * 10) / 10,
    }
  };

  // 生成详细评估
  if (avgProductivity >= 80) {
    insights.overall = `✨ 工作状态优秀！最近平均效率 ${avgProductivity}%，专注度 ${avgFocus}%`;
  } else if (avgProductivity >= 60) {
    insights.overall = `📊 工作状态良好，平均效率 ${avgProductivity}%，有提升空间`;
  } else {
    insights.overall = `⚠️ 效率偏低 (${avgProductivity}%)，建议调整工作方式`;
  }

  // 生成针对性建议
  if (hasFocusIssue) {
    insights.suggestions.push(`🎯 专注度预警：最近 ${lowFocusCount} 次记录显示专注度不足，建议关闭无关应用`);
  }
  
  if (topActivity && topActivity[1] > records.length * 0.5) {
    insights.suggestions.push(`📈 主要活动：${topActivity[0]}，已持续 ${topActivity[1]} 次记录`);
  }
  
  if (avgFocus < 70) {
    insights.suggestions.push('💡 建议：尝试番茄工作法，每25分钟专注工作，5分钟休息');
  }
  
  if (avgProductivity > 85) {
    insights.suggestions.push('🌟 保持当前状态，工作效率很高！');
  }

  // 时间段建议
  if (hour >= 9 && hour <= 11) {
    insights.suggestions.push('🌅 上午黄金时间：建议处理复杂有挑战性的任务');
  } else if (hour >= 14 && hour <= 17) {
    insights.suggestions.push('☕ 下午容易疲劳：可适当安排会议或重复性工作');
  } else if (hour >= 18) {
    insights.suggestions.push('🌙 一天工作结束：建议做工作总结和明日计划');
  }

  return insights;
}

// 截屏并分析
async function captureAndAnalyze() {
  try {
    let filepath = null;
    
    if (screenshot) {
      try {
        const imgBuffer = await screenshot({ format: 'png' });
        const filename = `screenshot_${Date.now()}.png`;
        filepath = path.join(CONFIG.screenshotDir, filename);
        fs.writeFileSync(filepath, imgBuffer);
      } catch (e) {
        console.log('截屏失败:', e.message);
      }
    }
    
    const timestamp = new Date().toISOString();
    let analysis;
    
    if (filepath && fs.existsSync(filepath)) {
      analysis = await analyzeScreenshot(filepath);
    } else {
      analysis = generateMockAnalysis();
    }
    
    analysis.timestamp = timestamp;
    
    // 存入数据库
    db.prepare('INSERT INTO work_records (status, activity, productivity, timestamp, detail, focus_score) VALUES (?, ?, ?, ?, ?, ?)')
      .run(analysis.status, analysis.activity, analysis.productivity, timestamp, analysis.detail || '', analysis.focus_score || analysis.productivity);
    
    // 清理旧数据
    db.prepare('DELETE FROM work_records WHERE id NOT IN (SELECT id FROM work_records ORDER BY timestamp DESC LIMIT 1000)').run();
    
    // 删除截图
    if (filepath && fs.existsSync(filepath)) {
      try { fs.unlinkSync(filepath); } catch (e) { }
    }
    
    // 更新设置
    const totalCaptures = db.prepare('SELECT COUNT(*) as count FROM work_records').get().count;
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('lastCapture', JSON.stringify(timestamp));
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('totalCaptures', JSON.stringify(totalCaptures));
    
    const mode = filepath ? '📸真实' : '🎭模拟';
    console.log(`[${format(new Date(), 'HH:mm:ss')}] ${mode} - ${analysis.status} | ${analysis.activity} | 效率:${analysis.productivity}% 专注:${analysis.focus_score || analysis.productivity}%`);
    if (analysis.detail) {
      console.log(`    📝 ${analysis.detail}`);
    }
    
    return analysis;
  } catch (error) {
    console.error('处理失败:', error.message);
    return generateMockAnalysis();
  }
}

// API Routes
app.get('/api/status', (req, res) => {
  const latest = db.prepare('SELECT * FROM work_records ORDER BY timestamp DESC LIMIT 1').get();
  const totalCaptures = db.prepare('SELECT COUNT(*) as count FROM work_records').get().count;
  const lastCapture = db.prepare("SELECT value FROM settings WHERE key = 'lastCapture'").get();
  const monitoring = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'monitoring'").get()?.value || 'false');
  
  res.json({
    monitoring,
    lastCapture: lastCapture ? JSON.parse(lastCapture.value) : null,
    currentStatus: latest || null,
    totalRecords: totalCaptures,
    totalCaptures,
  });
});

app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const total = db.prepare('SELECT COUNT(*) as count FROM work_records').get().count;
  const records = db.prepare('SELECT * FROM work_records ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json({ records, total, limit, offset });
});

app.post('/api/screenshot', async (req, res) => {
  try {
    const result = await captureAndAnalyze();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/insights', (req, res) => {
  const insights = generateInsights();
  const records = db.prepare('SELECT * FROM work_records ORDER BY timestamp DESC LIMIT 20').all();
  const todayRecords = db.prepare("SELECT COUNT(*) as count FROM work_records WHERE date(timestamp) = date('now')").get().count;
  const avgProductivity = records.length > 0 ? Math.round(records.reduce((sum, r) => sum + r.productivity, 0) / records.length) : 0;
  const avgFocus = records.length > 0 ? Math.round(records.reduce((sum, r) => sum + (r.focus_score || r.productivity), 0) / records.length) : 0;
  
  const stats = {
    totalHours: (db.prepare('SELECT COUNT(*) as count FROM work_records').get().count * 5) / 3600,
    avgProductivity,
    avgFocus,
    todayRecords,
    totalCaptures: db.prepare('SELECT COUNT(*) as count FROM work_records').get().count,
  };
  
  res.json({ insights, stats });
});

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = JSON.parse(row.value);
  }
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const { captureInterval, monitoring } = req.body;
  
  if (captureInterval !== undefined) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('captureInterval', JSON.stringify(Math.max(1000, Math.min(300000, captureInterval))));
  }
  
  if (monitoring !== undefined) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('monitoring', JSON.stringify(monitoring));
    
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }
    
    if (monitoring) {
      captureAndAnalyze();
      const interval = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'captureInterval'").get()?.value || '5000');
      monitorInterval = setInterval(captureAndAnalyze, interval);
      console.log(`🟢 监控已启动，间隔: ${interval/1000}秒`);
    } else {
      console.log('🔴 监控已停止');
    }
  }
  
  res.json({ success: true });
});

app.get('/api/health', (req, res) => res.json({ 
  status: 'ok', 
  timestamp: new Date().toISOString(),
  openaiConfigured: !!openai,
  realScreenshot: !!screenshot,
}));

// 启动
app.listen(PORT, () => {
  console.log(`\n🤖 WatchBot Server http://localhost:${PORT}`);
  console.log(`📁 数据库: ${CONFIG.dbPath}`);
  console.log(`📋 配置: 真实截屏=${!!screenshot}, OpenAI=${!!openai}\n`);
});