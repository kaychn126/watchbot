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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_timestamp ON work_records(timestamp);
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
          { type: 'text', text: '分析截图，判断工作状态和效率。只返回JSON: {"status":"状态","activity":"活动","productivity":分数}' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
        ]
      }],
      max_tokens: 200,
    });
    
    const content = response.choices[0].message.content;
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return generateMockAnalysis();
  } catch (error) {
    console.error('AI分析失败:', error.message);
    return generateMockAnalysis();
  }
}

// 生成模拟分析
function generateMockAnalysis() {
  const activities = ['Coding 🖥️', '文档处理 📝', '会议 💼', '浏览器浏览 🌐', '邮件处理 📧', '休息 ☕'];
  const statuses = ['高效工作', '普通工作', '轻微分心', '休息中'];
  return {
    status: Math.random() < 0.7 ? statuses[1] : statuses[Math.floor(Math.random() * 4)],
    activity: activities[Math.floor(Math.random() * activities.length)],
    productivity: Math.floor(Math.random() * 30) + 70,
  };
}

// 生成优化建议
function generateInsights() {
  const records = db.prepare('SELECT * FROM work_records ORDER BY timestamp DESC LIMIT 20').all();
  
  if (records.length < 3) {
    return {
      overall: '数据收集中...',
      suggestions: ['继续工作，系统正在学习您的工作模式'],
      trend: 'stable'
    };
  }

  const avgProductivity = Math.round(records.reduce((sum, r) => sum + r.productivity, 0) / records.length);
  
  const insights = {
    overall: avgProductivity > 80 ? '工作效率优秀 ✨' : avgProductivity > 60 ? '工作效率良好' : '有提升空间 📈',
    suggestions: [],
    trend: avgProductivity > 75 ? 'up' : avgProductivity > 60 ? 'stable' : 'down'
  };

  if (avgProductivity < 70) {
    insights.suggestions.push('📱 建议减少社交媒体浏览时间');
    insights.suggestions.push('⏰ 尝试番茄工作法');
  } else {
    insights.suggestions.push('✅ 继续保持高效状态');
    insights.suggestions.push('💡 建议定期工作总结');
  }

  const hour = new Date().getHours();
  if (hour >= 9 && hour <= 11) insights.suggestions.push('🌅 上午黄金时间');
  else if (hour >= 14 && hour <= 17) insights.suggestions.push('☕ 下午适当休息');
  else if (hour >= 18) insights.suggestions.push('🌙 辛苦了，注意休息');

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
    db.prepare('INSERT INTO work_records (status, activity, productivity, timestamp) VALUES (?, ?, ?, ?)')
      .run(analysis.status, analysis.activity, analysis.productivity, timestamp);
    
    // 清理旧数据（保留最近1000条）
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
    console.log(`[${format(new Date(), 'HH:mm:ss')}] ${mode} - ${analysis.status} | ${analysis.activity} | ${analysis.productivity}%`);
    
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
  
  const stats = {
    totalHours: (db.prepare('SELECT COUNT(*) as count FROM work_records').get().count * 5) / 3600,
    avgProductivity,
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