const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { format } = require('date-fns');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const CONFIG = {
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  captureInterval: 5000,
  screenshotDir: path.join(__dirname, '../screenshots'),
  dbPath: path.join(__dirname, '../data/watchbot.db'),
};

const dataDir = path.dirname(CONFIG.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(CONFIG.dbPath);

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
  
  CREATE TABLE IF NOT EXISTS session_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    total_records INTEGER NOT NULL,
    avg_productivity INTEGER NOT NULL,
    avg_focus INTEGER NOT NULL,
    main_activity TEXT,
    summary TEXT NOT NULL,
    suggestions TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_timestamp ON work_records(timestamp);
  CREATE INDEX IF NOT EXISTS idx_session_end ON session_summary(end_time);
`);

const defaultSettings = {
  captureInterval: 5000,
  monitoring: false,
  lastSessionStart: null,
};
for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

let screenshot = null;
if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
  try { screenshot = require('screenshot-desktop'); console.log('✓ screenshot-desktop'); } catch (e) { }
} else { console.log('ℹ 无图形环境'); }

let OpenAI = null;
try { OpenAI = require('openai'); } catch (e) { }

let openai = null;
if (CONFIG.openaiApiKey && OpenAI) {
  openai = new OpenAI({ apiKey: CONFIG.openaiApiKey });
}

if (!fs.existsSync(CONFIG.screenshotDir)) {
  fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
}

let monitorInterval = null;
let sessionStartTime = null;

const ANALYSIS_PROMPT = `你是一个专业的工作效率分析师。请仔细分析用户当前屏幕截图，评估工作状态。

请从以下维度进行分析：
1. **当前活动 (activity)**: 具体在做什么
2. **工作状态 (status)**: 高效工作/普通工作/严重分心/休息中
3. **专注度评分 (focus_score)**: 0-100
4. **详细描述 (detail)**: 15-30字，包含持续时间、产出、建议
5. **效率分数 (productivity)**: 0-100

只返回JSON:
{"status":"状态","activity":"活动","focus_score":专注度,"detail":"详细描述","productivity":效率}`;

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
      if (!result.detail) result.detail = `${result.activity}，状态: ${result.status}`;
      if (!result.focus_score) result.focus_score = result.productivity;
      return result;
    }
    return generateMockAnalysis();
  } catch (error) {
    console.error('AI分析失败:', error.message);
    return generateMockAnalysis();
  }
}

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

// 生成会话总结
function generateSessionSummary(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMinutes = Math.round((end - start) / 60000);
  
  // 获取本次会话的所有记录
  const records = db.prepare(
    'SELECT * FROM work_records WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp'
  ).all(startTime, endTime);
  
  if (records.length === 0) {
    return null;
  }
  
  const avgProductivity = Math.round(records.reduce((sum, r) => sum + r.productivity, 0) / records.length);
  const avgFocus = Math.round(records.reduce((sum, r) => sum + (r.focus_score || r.productivity), 0) / records.length);
  
  // 统计主要活动
  const activityCount = {};
  records.forEach(r => {
    const act = r.activity.replace(/[🖥️📝💼🌐📧☕]/g, '').trim();
    activityCount[act] = (activityCount[act] || 0) + 1;
  });
  const mainActivity = Object.entries(activityCount).sort((a, b) => b[1] - a[1])[0];
  
  // 生成总结文案
  let summary = '';
  let suggestions = '';
  
  if (durationMinutes < 5) {
    summary = `本次工作时长 ${durationMinutes} 分钟，记录 ${records.length} 条`;
  } else if (avgProductivity >= 80) {
    summary = `本次工作 ${durationMinutes} 分钟，平均效率 ${avgProductivity}%，专注度 ${avgFocus}%，状态优秀！`;
  } else if (avgProductivity >= 60) {
    summary = `本次工作 ${durationMinutes} 分钟，平均效率 ${avgProductivity}%，状态良好`;
  } else {
    summary = `本次工作 ${durationMinutes} 分钟，平均效率 ${avgProductivity}%，有提升空间`;
  }
  
  if (mainActivity) {
    summary += `。主要活动为「${mainActivity[0]}」，持续了约 ${Math.round(mainActivity[1] * 5)} 分钟`;
  }
  
  // 生成建议
  const suggestionsList = [];
  if (avgFocus < 70) {
    suggestionsList.push('专注度偏低，建议减少应用切换');
  }
  if (records.length > 0) {
    const focusTrend = records.slice(-5);
    const trend = focusTrend.reduce((sum, r) => sum + (r.focus_score || r.productivity), 0) / focusTrend.length;
    if (trend > avgFocus + 5) {
      suggestionsList.push('后期专注度有所提升，继续保持');
    } else if (trend < avgFocus - 5) {
      suggestionsList.push('注意后期有些疲劳，可以适当休息');
    }
  }
  if (avgProductivity >= 80) {
    suggestionsList.push('工作效率很高，保持当前状态');
  } else if (avgProductivity < 60) {
    suggestionsList.push('建议尝试番茄工作法提升效率');
  }
  
  const lastRecord = records[records.length - 1];
  if (lastRecord && lastRecord.detail) {
    suggestionsList.push(`最后：${lastRecord.detail}`);
  }
  
  suggestions = suggestionsList.join('；');
  if (!suggestions) suggestions = '继续加油！';
  
  return {
    start_time: startTime,
    end_time: endTime,
    duration_minutes: durationMinutes,
    total_records: records.length,
    avg_productivity: avgProductivity,
    avg_focus: avgFocus,
    main_activity: mainActivity ? mainActivity[0] : null,
    summary,
    suggestions,
  };
}

function generateInsights() {
  const records = db.prepare('SELECT * FROM work_records ORDER BY timestamp DESC LIMIT 30').all();
  
  if (records.length < 5) {
    return {
      overall: '数据收集中...',
      suggestions: ['继续工作，系统正在学习您的工作模式'],
      trend: 'stable'
    };
  }

  const avgProductivity = Math.round(records.reduce((sum, r) => sum + r.productivity, 0) / records.length);
  const avgFocus = Math.round(records.reduce((sum, r) => sum + (r.focus_score || r.productivity), 0) / records.length);
  
  const activityCount = {};
  records.forEach(r => {
    const act = r.activity.replace(/[🖥️📝💼🌐📧☕]/g, '').trim();
    activityCount[act] = (activityCount[act] || 0) + 1;
  });
  const topActivity = Object.entries(activityCount).sort((a, b) => b[1] - a[1])[0];
  
  const lowFocusCount = records.filter(r => (r.focus_score || r.productivity) < 70).length;
  const hasFocusIssue = lowFocusCount > records.length * 0.3;
  
  const hour = new Date().getHours();
  
  const insights = {
    overall: '',
    suggestions: [],
    trend: avgProductivity > 80 ? 'up' : avgProductivity > 60 ? 'stable' : 'down',
    details: {
      avgProductivity,
      avgFocus,
      topActivity: topActivity ? topActivity[0] : '未知',
    }
  };

  if (avgProductivity >= 80) {
    insights.overall = `✨ 工作状态优秀！效率 ${avgProductivity}%，专注度 ${avgFocus}%`;
  } else if (avgProductivity >= 60) {
    insights.overall = `📊 工作状态良好，效率 ${avgProductivity}%`;
  } else {
    insights.overall = `⚠️ 效率偏低 (${avgProductivity}%)`;
  }

  if (hasFocusIssue) {
    insights.suggestions.push(`🎯 专注度预警：最近 ${lowFocusCount} 次记录显示专注度不足`);
  }
  
  if (topActivity && topActivity[1] > records.length * 0.4) {
    insights.suggestions.push(`📈 主要活动：${topActivity[0]} (${topActivity[1]} 次)`);
  }
  
  if (avgFocus < 70) {
    insights.suggestions.push('💡 建议使用番茄工作法');
  }

  if (hour >= 9 && hour <= 11) insights.suggestions.push('🌅 上午黄金时间');
  else if (hour >= 14 && hour <= 17) insights.suggestions.push('☕ 下午适当休息');
  else if (hour >= 18) insights.suggestions.push('🌙 注意休息');

  return insights;
}

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
    
    db.prepare('INSERT INTO work_records (status, activity, productivity, timestamp, detail, focus_score) VALUES (?, ?, ?, ?, ?, ?)')
      .run(analysis.status, analysis.activity, analysis.productivity, timestamp, analysis.detail || '', analysis.focus_score || analysis.productivity);
    
    db.prepare('DELETE FROM work_records WHERE id NOT IN (SELECT id FROM work_records ORDER BY timestamp DESC LIMIT 1000)').run();
    
    if (filepath && fs.existsSync(filepath)) {
      try { fs.unlinkSync(filepath); } catch (e) { }
    }
    
    const totalCaptures = db.prepare('SELECT COUNT(*) as count FROM work_records').get().count;
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('lastCapture', JSON.stringify(timestamp));
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('totalCaptures', JSON.stringify(totalCaptures));
    
    const mode = filepath ? '📸' : '🎭';
    console.log(`[${format(new Date(), 'HH:mm:ss')}] ${mode} ${analysis.status} | ${analysis.activity} | 效率:${analysis.productivity}% 专注:${analysis.focus_score || analysis.productivity}%`);
    
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
  
  // 获取最后一次会话总结
  const lastSummary = db.prepare('SELECT * FROM session_summary ORDER BY end_time DESC LIMIT 1').get();
  
  res.json({
    monitoring,
    lastCapture: lastCapture ? JSON.parse(lastCapture.value) : null,
    currentStatus: latest || null,
    totalRecords: totalCaptures,
    totalCaptures,
    lastSummary: lastSummary || null,
  });
});

app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const total = db.prepare('SELECT COUNT(*) as count FROM work_records').get().count;
  const records = db.prepare('SELECT * FROM work_records ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json({ records, total, limit, offset });
});

// 获取会话总结列表
app.get('/api/sessions', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  const total = db.prepare('SELECT COUNT(*) as count FROM session_summary').get().count;
  const sessions = db.prepare('SELECT * FROM session_summary ORDER BY end_time DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json({ sessions, total, limit, offset });
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
    const wasMonitoring = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'monitoring'").get()?.value || 'false');
    const lastSessionStart = db.prepare("SELECT value FROM settings WHERE key = 'lastSessionStart'").get();
    sessionStartTime = lastSessionStart ? JSON.parse(lastSessionStart.value) : null;
    
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('monitoring', JSON.stringify(monitoring));
    
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }
    
    if (monitoring) {
      // 开始新会话
      sessionStartTime = new Date().toISOString();
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('lastSessionStart', JSON.stringify(sessionStartTime));
      
      captureAndAnalyze();
      const interval = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'captureInterval'").get()?.value || '5000');
      monitorInterval = setInterval(captureAndAnalyze, interval);
      console.log(`🟢 监控已启动，间隔: ${interval/1000}秒，会话开始: ${sessionStartTime}`);
    } else if (wasMonitoring && sessionStartTime) {
      // 停止监控，生成会话总结
      const endTime = new Date().toISOString();
      const summary = generateSessionSummary(sessionStartTime, endTime);
      
      if (summary && summary.total_records > 0) {
        db.prepare(`
          INSERT INTO session_summary (start_time, end_time, duration_minutes, total_records, avg_productivity, avg_focus, main_activity, summary, suggestions)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          summary.start_time,
          summary.end_time,
          summary.duration_minutes,
          summary.total_records,
          summary.avg_productivity,
          summary.avg_focus,
          summary.main_activity,
          summary.summary,
          summary.suggestions
        );
        
        console.log(`📊 会话总结已生成：${summary.summary}`);
      }
      
      sessionStartTime = null;
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('lastSessionStart', JSON.stringify(null));
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

app.listen(PORT, () => {
  console.log(`\n🤖 WatchBot Server http://localhost:${PORT}`);
  console.log(`📁 数据库: ${CONFIG.dbPath}\n`);
});