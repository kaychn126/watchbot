const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { format } = require('date-fns');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// 配置文件
const CONFIG = {
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  captureInterval: 5000, // 5秒
  screenshotDir: path.join(__dirname, '../screenshots'),
  maxHistory: 1000,
  useRealScreenshot: false, // 必须在有图形环境时才能设为 true
};

// 只在有 DISPLAY 环境变量时才尝试加载截屏库
let screenshot = null;
if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
  try {
    screenshot = require('screenshot-desktop');
    CONFIG.useRealScreenshot = true;
    console.log('✓ screenshot-desktop 已加载');
  } catch (e) {
    console.log('✗ 无法加载 screenshot-desktop');
  }
} else {
  console.log('ℹ 无图形环境 (DISPLAY 未设置)，使用模拟截屏');
}

// 尝试加载 OpenAI
let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (e) {
  console.log('✗ 无法加载 openai');
}

// 确保截图目录存在
if (!fs.existsSync(CONFIG.screenshotDir)) {
  fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
}

// OpenAI 客户端
let openai = null;
if (CONFIG.openaiApiKey && OpenAI) {
  openai = new OpenAI({ apiKey: CONFIG.openaiApiKey });
}

// 内存存储
let workRecords = [];
let settings = {
  captureInterval: 5000,
  monitoring: false,
  lastCapture: null,
  totalCaptures: 0,
};

let monitorInterval = null;

// AI 分析截图
async function analyzeScreenshot(imagePath) {
  if (!openai || !fs.existsSync(imagePath)) {
    return generateMockAnalysis();
  }
  
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '分析这张截图，描述用户在做什么工作，判断工作状态是高效工作、普通工作、轻度分心还是休息中，以及估计 productivity 分数（0-100）。只返回 JSON: {"status": "状态", "activity": "活动描述", "productivity": 分数}'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 300,
    });
    
    const content = response.choices[0].message.content;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) { }
    
    return generateMockAnalysis();
  } catch (error) {
    console.error('AI 分析失败:', error.message);
    return generateMockAnalysis();
  }
}

// 生成模拟分析
function generateMockAnalysis() {
  const activities = ['Coding 🖥️', '文档处理 📝', '会议 💼', '浏览器浏览 🌐', '邮件处理 📧', '休息 ☕'];
  const randomActivity = activities[Math.floor(Math.random() * activities.length)];
  
  const statuses = ['高效工作', '普通工作', '轻微分心', '休息中'];
  const currentStatus = Math.random() < 0.7 
    ? statuses[1] 
    : statuses[Math.floor(Math.random() * statuses.length)];
  
  return {
    status: currentStatus,
    activity: randomActivity,
    productivity: Math.floor(Math.random() * 30) + 70,
  };
}

// 生成优化建议
function generateInsights(records) {
  if (records.length < 3) {
    return {
      overall: '数据收集中，请稍等...',
      suggestions: [
        '继续您的工作，系统正在学习您的工作模式',
        '建议保持规律的工作节奏'
      ],
      trend: 'stable'
    };
  }

  const recentRecords = records.slice(-20);
  const avgProductivity = recentRecords.reduce((sum, r) => sum + r.productivity, 0) / recentRecords.length;
  
  const insights = {
    overall: avgProductivity > 80 ? '工作效率优秀 ✨' : avgProductivity > 60 ? '工作效率良好' : '有提升空间 📈',
    suggestions: [],
    trend: avgProductivity > 75 ? 'up' : avgProductivity > 60 ? 'stable' : 'down'
  };

  if (avgProductivity < 70) {
    insights.suggestions.push('📱 建议减少社交媒体的浏览时间');
    insights.suggestions.push('⏰ 尝试使用番茄工作法，每25分钟休息5分钟');
  } else {
    insights.suggestions.push('✅ 继续保持高效工作状态');
    insights.suggestions.push('💡 建议定期进行工作总结');
  }

  const hour = new Date().getHours();
  if (hour >= 9 && hour <= 11) {
    insights.suggestions.push('🌅 上午是黄金工作时间，建议处理复杂任务');
  } else if (hour >= 14 && hour <= 17) {
    insights.suggestions.push('☕ 下午容易犯困，适当休息很重要');
  } else if (hour >= 18) {
    insights.suggestions.push('🌙 一天工作辛苦了，注意劳逸结合');
  }

  return insights;
}

// 截屏并分析
async function captureAndAnalyze() {
  try {
    let imgBuffer = null;
    let filepath = null;
    
    if (CONFIG.useRealScreenshot && screenshot) {
      try {
        imgBuffer = await screenshot({ format: 'png' });
        
        const timestamp = Date.now();
        const filename = `screenshot_${timestamp}.png`;
        filepath = path.join(CONFIG.screenshotDir, filename);
        fs.writeFileSync(filepath, imgBuffer);
      } catch (e) {
        console.log('截屏失败，使用模拟数据:', e.message);
        CONFIG.useRealScreenshot = false;
      }
    }
    
    settings.totalCaptures++;
    settings.lastCapture = new Date().toISOString();
    
    let analysis;
    if (filepath && fs.existsSync(filepath)) {
      analysis = await analyzeScreenshot(filepath);
    } else {
      analysis = generateMockAnalysis();
    }
    
    analysis.timestamp = settings.lastCapture;
    
    workRecords.push(analysis);
    
    if (workRecords.length > CONFIG.maxHistory) {
      workRecords = workRecords.slice(-CONFIG.maxHistory);
    }
    
    // 删除截图文件
    if (filepath && fs.existsSync(filepath)) {
      try { fs.unlinkSync(filepath); } catch (e) { }
    }
    
    console.log(`[${format(new Date(), 'HH:mm:ss')}] ${CONFIG.useRealScreenshot ? '📸 真实截屏' : '🎭 模拟数据'} - ${analysis.status} | ${analysis.activity} | 效率: ${analysis.productivity}`);
    
    return analysis;
  } catch (error) {
    console.error('处理失败:', error.message);
    const mockAnalysis = generateMockAnalysis();
    mockAnalysis.timestamp = new Date().toISOString();
    
    settings.totalCaptures++;
    settings.lastCapture = mockAnalysis.timestamp;
    workRecords.push(mockAnalysis);
    
    if (workRecords.length > CONFIG.maxHistory) {
      workRecords = workRecords.slice(-CONFIG.maxHistory);
    }
    
    return mockAnalysis;
  }
}

// API Routes
app.get('/api/status', (req, res) => {
  const latest = workRecords[workRecords.length - 1];
  res.json({
    monitoring: settings.monitoring,
    lastCapture: settings.lastCapture,
    currentStatus: latest || null,
    totalRecords: workRecords.length,
    totalCaptures: settings.totalCaptures,
    realScreenshot: CONFIG.useRealScreenshot,
  });
});

app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const records = workRecords.slice(-limit - offset).slice(0, limit);
  res.json({ records, total: workRecords.length, limit, offset });
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
  const insights = generateInsights(workRecords);
  const stats = {
    totalHours: workRecords.length * (settings.captureInterval / 3600000),
    avgProductivity: workRecords.length > 0 
      ? Math.round(workRecords.reduce((sum, r) => sum + r.productivity, 0) / workRecords.length)
      : 0,
    todayRecords: workRecords.filter(r => {
      const today = new Date().toDateString();
      return new Date(r.timestamp).toDateString() === today;
    }).length,
    totalCaptures: settings.totalCaptures,
  };
  res.json({ insights, stats });
});

app.get('/api/settings', (req, res) => res.json(settings));

app.put('/api/settings', (req, res) => {
  const { captureInterval, monitoring } = req.body;
  
  if (captureInterval !== undefined) {
    settings.captureInterval = Math.max(1000, Math.min(300000, captureInterval));
  }
  
  if (monitoring !== undefined) {
    settings.monitoring = monitoring;
    
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }
    
    if (monitoring) {
      captureAndAnalyze();
      monitorInterval = setInterval(() => {
        if (settings.monitoring) captureAndAnalyze();
      }, settings.captureInterval);
      console.log(`🟢 监控已启动，间隔: ${settings.captureInterval/1000}秒`);
    } else {
      console.log('🔴 监控已停止');
    }
  }
  
  res.json({ success: true, settings });
});

app.get('/api/health', (req, res) => res.json({ 
  status: 'ok', 
  timestamp: new Date().toISOString(),
  openaiConfigured: !!openai,
  realScreenshot: CONFIG.useRealScreenshot,
}));

app.listen(PORT, () => {
  console.log(`\n🤖 WatchBot Server http://localhost:${PORT}`);
  console.log(`📋 配置: 真实截屏=${CONFIG.useRealScreenshot ? '是' : '否 (模拟)'}, OpenAI=${openai ? '是' : '否'}\n`);
});