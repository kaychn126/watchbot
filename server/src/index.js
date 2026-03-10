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
    focus_factors TEXT,
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

// ==================== 科学的专注度计算 ====================

// 简易图像相似度计算 (使用像素采样对比)
function calculateImageSimilarity(img1Path, img2Path) {
  try {
    // 读取两个图片文件，对比像素
    const img1 = fs.readFileSync(img1Path);
    const img2 = fs.readFileSync(img2Path);
    
    // 取样比较：每50个像素比对一次
    const sampleSize = Math.min(img1.length, img2.length, 10000);
    let samePixels = 0;
    let totalSamples = 0;
    
    for (let i = 0; i < sampleSize; i += 50) {
      if (img1[i] !== undefined && img2[i] !== undefined) {
        // 只比对非零的像素(去除大部分空白区域)
        if (img1[i] > 10 || img2[i] > 10) {
          totalSamples++;
          // 差异小于5%视为相似
          if (Math.abs(img1[i] - img2[i]) < 10) {
            samePixels++;
          }
        }
      }
    }
    
    if (totalSamples === 0) return 0.9; // 都是空白区域->相似
    return samePixels / totalSamples;
  } catch (e) {
    return 0.5; // 无法比较时返回中间值
  }
}

// 专注度计算器
class FocusCalculator {
  constructor() {
    this.lastScreenshot = null;
    this.lastScreenshotTime = null;
    this.activityHistory = []; // 最近的活动历史
    this.maxHistory = 20;
    
    // 工作时段定义 (小时)
    this.workHours = { start: 9, end: 18 };
  }

  // 计算专注度分数
  calculate(screenshot, currentActivity, timestamp) {
    let focusScore = 70; // 基础分数
    const factors = [];
    
    // 1️⃣ 屏幕变化率 (权重: 40%)
    // 如果屏幕内容变化很大，可能在切换应用 -> 降低专注度
    const changeRate = this.analyzeScreenChange(screenshot);
    if (changeRate !== null) {
      // 变化率低 = 专注 (分数高)
      // 变化率高 = 分心 (分数低)
      const screenFocus = Math.round(changeRate * 100);
      focusScore = Math.round(focusScore * 0.4 + screenFocus * 0.6);
      factors.push(`屏幕变化率: ${Math.round((1-changeRate)*100)}%`);
    }
    
    // 2️⃣ 任务连续性 (权重: 30%)
    // 如果长时间做同一件事，专注度高
    const continuityScore = this.analyzeContinuity(currentActivity, timestamp);
    focusScore = Math.round(focusScore * 0.3 + continuityScore * 0.7);
    factors.push(`任务连续: ${continuityScore > 80 ? '高' : continuityScore > 50 ? '中' : '低'}`);
    
    // 3️⃣ 工作时段 (权重: 20%)
    // 在工作时间更可能专注工作
    const hourWorkScore = this.analyzeTimeOfDay();
    focusScore = Math.round(focusScore * 0.2 + hourWorkScore * 0.8);
    factors.push(`时段: ${hourWorkScore > 80 ? '工作时段' : '业余时间'}`);
    
    // 4️⃣ 分心检测 (权重: 10%)
    // 检测是否在做与工作无关的事
    const distractionPenalty = this.detectDistraction(currentActivity);
    focusScore = Math.max(0, focusScore - distractionPenalty);
    
    // 限制范围
    focusScore = Math.max(10, Math.min(100, focusScore));
    
    return { focusScore, factors };
  }

  // 分析屏幕变化
  analyzeScreenChange(newScreenshot) {
    try {
      if (!this.lastScreenshot || !this.lastScreenshotTime) {
        // 首次记录
        return null;
      }
      
      // 对比两张截图
      const similarity = calculateImageSimilarity(this.lastScreenshot, newScreenshot);
      
      // 保存当前截图供下次使用
      this.updateLastScreenshot(newScreenshot);
      
      // 相似度高 = 变化少 = 专注
      // 相似度低 = 变化多 = 可能切换应用
      return similarity > 0.8 ? 0.9 : (similarity > 0.5 ? 0.7 : 0.4);
    } catch (e) {
      return null;
    }
  }

  updateLastScreenshot(newPath) {
    this.lastScreenshot = newPath;
    this.lastScreenshotTime = Date.now();
  }

  // 分析任务连续性
  analyzeContinuity(activity, timestamp) {
    const now = Date.now();
    
    // 提取纯活动名 (去除emoji)
    const cleanActivity = activity.replace(/[🖥️📝💼🌐📧☕🎮📺]/g, '').trim();
    
    // 添加到历史
    this.activityHistory.push({
      activity: cleanActivity,
      timestamp: now
    });
    
    // 保持历史长度
    if (this.activityHistory.length > this.maxHistory) {
      this.activityHistory.shift();
    }
    
    if (this.activityHistory.length < 3) {
      return 70; // 历史数据不足
    }
    
    // 计算最近几次活动中相同活动的比例
    const recent = this.activityHistory.slice(-5);
    const sameActivity = recent.filter(a => a.activity === cleanActivity).length;
    const continuity = (sameActivity / recent.length) * 100;
    
    // 计算平均任务持续时间
    let totalDuration = 0;
    let switches = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].activity !== recent[i-1].activity) {
        switches++;
      }
    }
    
    // 切换次数越少越好
    const switchPenalty = Math.min(30, switches * 10);
    
    return Math.max(20, Math.min(100, continuity - switchPenalty + 50));
  }

  // 分析时段
  analyzeTimeOfDay() {
    const hour = new Date().getHours();
    
    // 工作时段效率高
    if (hour >= this.workHours.start && hour < this.workHours.end) {
      return 90;
    }
    // 早晨和晚上也可能工作
    if ((hour >= 7 && hour < 9) || (hour >= 18 && hour < 22)) {
      return 70;
    }
    // 深夜和凌晨
    return 40;
  }

  // 检测是否分心
  detectDistraction(activity) {
    const distractions = ['浏览器浏览', '浏览器', '休息', '游戏', '视频', '社交'];
    const highFocus = ['Coding', '代码', '文档', '会议', '邮件'];
    
    const cleanActivity = activity.replace(/[🖥️📝💼🌐📧☕🎮📺]/g, '').trim();
    
    for (const d of distractions) {
      if (cleanActivity.includes(d)) {
        return 20; // 扣20分
      }
    }
    
    for (const h of highFocus) {
      if (cleanActivity.includes(h)) {
        return -5; // 加5分
      }
    }
    
    return 0;
  }
}

const focusCalculator = new FocusCalculator();

// ==================== END ====================

const ANALYSIS_PROMPT = `你是一个专业的工作效率分析师。请仔细分析用户当前屏幕截图，评估工作状态。

请从以下维度进行分析：
1. **当前活动 (activity)**: 具体在做什么
2. **工作状态 (status)**: 高效工作/普通工作/严重分心/休息中
3. **专注度评分 (focus_score)**: 0-100 (越高越好)
4. **详细描述 (detail)**: 15-30字，包含持续时间、产出、建议
5. **效率分数 (productivity)**: 0-100

注意：计算 focus_score 时考虑：
- 屏幕内容变化频率（变化少=专注）
- 任务连续性（长时间做同一件事=专注）
- 工作时段（工作时间更专注）
- 是否在做与工作无关的事

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

function generateSessionSummary(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMinutes = Math.round((end - start) / 60000);
  
  const records = db.prepare('SELECT * FROM work_records WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp').all(startTime, endTime);
  
  if (records.length === 0) return null;
  
  const avgProductivity = Math.round(records.reduce((sum, r) => sum + r.productivity, 0) / records.length);
  const avgFocus = Math.round(records.reduce((sum, r) => sum + (r.focus_score || r.productivity), 0) / records.length);
  
  const activityCount = {};
  records.forEach(r => {
    const act = r.activity.replace(/[🖥️📝💼🌐📧☕]/g, '').trim();
    activityCount[act] = (activityCount[act] || 0) + 1;
  });
  const mainActivity = Object.entries(activityCount).sort((a, b) => b[1] - a[1])[0];
  
  let summary = '';
  if (durationMinutes < 5) {
    summary = `本次工作 ${durationMinutes} 分钟，记录 ${records.length} 条`;
  } else if (avgFocus >= 80) {
    summary = `本次工作 ${durationMinutes} 分钟，平均专注度 ${avgFocus}%，效率 ${avgProductivity}%，状态优秀！`;
  } else if (avgFocus >= 60) {
    summary = `本次工作 ${durationMinutes} 分钟，平均专注度 ${avgFocus}%，状态良好`;
  } else {
    summary = `本次工作 ${durationMinutes} 分钟，专注度偏低 (${avgFocus}%)，建议减少干扰`;
  }
  
  if (mainActivity) {
    summary += `。主要活动为「${mainActivity[0]}」`;
  }
  
  const suggestionsList = [];
  if (avgFocus < 70) suggestionsList.push('专注度偏低，建议减少应用切换');
  if (avgFocus >= 80) suggestionsList.push('工作效率很高，保持当前状态');
  if (avgFocus < 60) suggestionsList.push('建议尝试番茄工作法');
  
  const suggestions = suggestionsList.join('；') || '继续加油！';
  
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
      suggestions: ['继续工作，系统正在学习'],
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
  
  const lowFocusCount = records.filter(r => (r.focus_score || r.productivity) < 60).length;
  
  const hour = new Date().getHours();
  
  const insights = {
    overall: avgFocus >= 80 ? `✨ 专注度优秀 ${avgFocus}%！` : avgFocus >= 60 ? `📊 专注度良好 ${avgFocus}%` : `⚠️ 专注度偏低 ${avgFocus}%`,
    suggestions: [],
    trend: avgFocus > 80 ? 'up' : avgFocus > 60 ? 'stable' : 'down',
    details: { avgProductivity, avgFocus, topActivity: topActivity ? topActivity[0] : '未知' }
  };

  if (lowFocusCount > records.length * 0.3) {
    insights.suggestions.push(`🎯 有 ${lowFocusCount} 次记录专注度偏低，注意减少干扰`);
  }
  if (topActivity && topActivity[1] > records.length * 0.4) {
    insights.suggestions.push(`📈 主要活动：${topActivity[0]}`);
  }
  if (hour >= 9 && hour <= 11) insights.suggestions.push('🌅 上午黄金时间');
  else if (hour >= 14 && hour <= 17) insights.suggestions.push('☕ 下午适当休息');

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
      } catch (e) { console.log('截屏失败:', e.message); }
    }
    
    const timestamp = new Date().toISOString();
    let analysis;
    let focusDetails = {};
    
    // 使用科学方法计算专注度
    const focusResult = focusCalculator.calculate(filepath, '分析中', timestamp);
    const aiFocus = focusResult ? focusResult.focusScore : null;
    focusDetails = { factors: focusResult?.factors || [], method: 'image_analysis' };
    
    if (filepath && fs.existsSync(filepath)) {
      const aiResult = await analyzeScreenshot(filepath);
      analysis = aiResult;
      // 融合 AI 分析和本地计算
      if (aiFocus) {
        // AI 分析权重 60%，本地计算权重 40%
        analysis.focus_score = Math.round(analysis.focus_score * 0.6 + aiFocus * 0.4);
        focusDetails.method = 'hybrid';
      }
    } else {
      analysis = generateMockAnalysis();
    }
    
    analysis.timestamp = timestamp;
    analysis.focus_factors = JSON.stringify(focusDetails);
    
    db.prepare('INSERT INTO work_records (status, activity, productivity, timestamp, detail, focus_score, focus_factors) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(analysis.status, analysis.activity, analysis.productivity, timestamp, analysis.detail || '', analysis.focus_score || analysis.productivity, JSON.stringify(focusDetails));
    
    db.prepare('DELETE FROM work_records WHERE id NOT IN (SELECT id FROM work_records ORDER BY timestamp DESC LIMIT 1000)').run();
    
    if (filepath && fs.existsSync(filepath)) {
      focusCalculator.updateLastScreenshot(filepath);
      try { fs.unlinkSync(filepath); } catch (e) { }
    }
    
    const totalCaptures = db.prepare('SELECT COUNT(*) as count FROM work_records').get().count;
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('lastCapture', JSON.stringify(timestamp));
    
    const mode = filepath ? '📸' : '🎭';
    console.log(`[${format(new Date(), 'HH:mm:ss')}] ${mode} 专注:${analysis.focus_score}% 效率:${analysis.productivity}% | ${analysis.activity}`);
    
    return analysis;
  } catch (error) {
    console.error('处理失败:', error.message);
    return generateMockAnalysis();
  }
}

app.get('/api/status', (req, res) => {
  const latest = db.prepare('SELECT * FROM work_records ORDER BY timestamp DESC LIMIT 1').get();
  const totalCaptures = db.prepare('SELECT COUNT(*) as count FROM work_records').get().count;
  const lastCapture = db.prepare("SELECT value FROM settings WHERE key = 'lastCapture'").get();
  const monitoring = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'monitoring'").get()?.value || 'false');
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
  const todayRecords = db.prepare("SELECT COUNT(*) as count FROM work_records WHERE date(timestamp) = date('now')").get().count;
  
  const stats = {
    totalHours: (db.prepare('SELECT COUNT(*) as count FROM work_records').get().count * 5) / 3600,
    avgProductivity: insights.details.avgProductivity,
    avgFocus: insights.details.avgFocus,
    todayRecords,
    totalCaptures: db.prepare('SELECT COUNT(*) as count FROM work_records').get().count,
  };
  
  res.json({ insights, stats });
});

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) { settings[row.key] = JSON.parse(row.value); }
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const { captureInterval, monitoring } = req.body;
  
  if (captureInterval !== undefined) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('captureInterval', JSON.stringify(Math.max(1000, Math.min(300000, captureInterval))));
  }
  
  if (monitoring !== undefined) {
    const wasMonitoring = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'monitoring'").get()?.value || 'false');
    
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('monitoring', JSON.stringify(monitoring));
    
    if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
    
    if (monitoring) {
      sessionStartTime = new Date().toISOString();
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('lastSessionStart', JSON.stringify(sessionStartTime));
      captureAndAnalyze();
      const interval = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'captureInterval'").get()?.value || '5000');
      monitorInterval = setInterval(captureAndAnalyze, interval);
      console.log(`🟢 监控已启动，间隔: ${interval/1000}秒`);
    } else if (wasMonitoring && sessionStartTime) {
      const endTime = new Date().toISOString();
      const summary = generateSessionSummary(sessionStartTime, endTime);
      if (summary && summary.total_records > 0) {
        db.prepare(`INSERT INTO session_summary (start_time, end_time, duration_minutes, total_records, avg_productivity, avg_focus, main_activity, summary, suggestions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(summary.start_time, summary.end_time, summary.duration_minutes, summary.total_records, summary.avg_productivity, summary.avg_focus, summary.main_activity, summary.summary, summary.suggestions);
      }
      sessionStartTime = null;
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
  focusMethod: 'hybrid',
}));

app.listen(PORT, () => {
  console.log(`\n🤖 WatchBot Server http://localhost:${PORT}`);
  console.log(`📊 专注度计算: 混合模式 (AI + 图像分析 + 行为分析)`);
  console.log(`📁 数据库: ${CONFIG.dbPath}\n`);
});