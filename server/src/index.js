const express = require('express');
const cors = require('cors');
const path = require('path');
const { format } = require('date-fns');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage
let workRecords = [];
let settings = {
  captureInterval: 30000, // 30 seconds
  monitoring: false,
  lastCapture: null
};

let monitorInterval = null;

// AI Analysis Mock (可以接入真实的 AI API)
function analyzeWorkStatus(screenshotData) {
  const hour = new Date().getHours();
  const activities = [' Coding', ' 文档处理', ' 会议', ' 浏览器浏览', ' 邮件处理', ' 休息'];
  const randomActivity = activities[Math.floor(Math.random() * activities.length)];
  
  // 模拟工作状态分析
  const statuses = ['高效工作', '普通工作', '轻微分心', '休息中'];
  const currentStatus = statuses[Math.floor(Math.random() * 100) < 70 ? 1 : Math.floor(Math.random() * 4)];
  
  return {
    status: currentStatus,
    activity: randomActivity,
    productivity: Math.floor(Math.random() * 40) + 60, // 60-100
    timestamp: new Date().toISOString(),
    screenshot: screenshotData ? 'screenshot_captured' : null
  };
}

// 生成优化建议
function generateInsights(records) {
  if (records.length < 5) {
    return {
      overall: '数据收集中，请稍等...',
      suggestions: [
        '继续您的工作，系统正在学习您的工作模式',
        '建议保持规律的工作节奏'
      ],
      trend: 'stable'
    };
  }

  const recentRecords = records.slice(-10);
  const avgProductivity = recentRecords.reduce((sum, r) => sum + r.productivity, 0) / recentRecords.length;
  
  const insights = {
    overall: avgProductivity > 80 ? '工作效率优秀' : avgProductivity > 60 ? '工作效率良好' : '有提升空间',
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

  // 基于时间段的建议
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

// 截屏功能 (模拟)
async function captureScreen() {
  try {
    // 注意: 实际部署时需要安装 screenshot-desktop
    // const screenshot = await screenshotDesktop({ format: 'png' });
    const mockScreenshot = `data:image/png;base64,mock_${Date.now()}`;
    
    const analysis = analyzeWorkStatus(mockScreenshot);
    workRecords.push(analysis);
    
    // 保持最近 1000 条记录
    if (workRecords.length > 1000) {
      workRecords = workRecords.slice(-1000);
    }
    
    settings.lastCapture = new Date().toISOString();
    
    console.log(`[${format(new Date(), 'HH:mm:ss')}] 截屏并分析完成 - 状态: ${analysis.status}, 活动: ${analysis.activity}`);
    return analysis;
  } catch (error) {
    console.error('截屏失败:', error.message);
    return null;
  }
}

// API Routes

// 获取当前状态
app.get('/api/status', (req, res) => {
  const latest = workRecords[workRecords.length - 1];
  res.json({
    monitoring: settings.monitoring,
    lastCapture: settings.lastCapture,
    currentStatus: latest || null,
    totalRecords: workRecords.length
  });
});

// 获取历史记录
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  
  const records = workRecords.slice(-limit - offset).slice(0, limit);
  res.json({
    records,
    total: workRecords.length,
    limit,
    offset
  });
});

// 手动触发截屏
app.post('/api/screenshot', async (req, res) => {
  try {
    const result = await captureScreen();
    if (result) {
      res.json({ success: true, data: result });
    } else {
      res.status(500).json({ success: false, error: '截屏失败' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取优化建议
app.get('/api/insights', (req, res) => {
  const insights = generateInsights(workRecords);
  
  // 附加统计信息
  const stats = {
    totalHours: workRecords.length * (settings.captureInterval / 3600000),
    avgProductivity: workRecords.length > 0 
      ? Math.round(workRecords.reduce((sum, r) => sum + r.productivity, 0) / workRecords.length)
      : 0,
    todayRecords: workRecords.filter(r => {
      const today = new Date().toDateString();
      return new Date(r.timestamp).toDateString() === today;
    }).length
  };
  
  res.json({ insights, stats });
});

// 获取/更新设置
app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const { captureInterval, monitoring } = req.body;
  
  if (captureInterval !== undefined) {
    settings.captureInterval = Math.max(10000, Math.min(300000, captureInterval));
  }
  
  if (monitoring !== undefined) {
    settings.monitoring = monitoring;
    
    if (monitoring && !monitorInterval) {
      // 启动监控
      monitorInterval = setInterval(() => {
        captureScreen();
      }, settings.captureInterval);
      console.log(`监控已启动，间隔: ${settings.captureInterval/1000}秒`);
    } else if (!monitoring && monitorInterval) {
      // 停止监控
      clearInterval(monitorInterval);
      monitorInterval = null;
      console.log('监控已停止');
    }
  }
  
  res.json({ success: true, settings });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 静态文件 (如果需要)
app.use(express.static(path.join(__dirname, '../public')));

app.listen(PORT, () => {
  console.log(`\n🤖 WatchBot Server 运行在 http://localhost:${PORT}`);
  console.log(`📊 API 端点:`);
  console.log(`   - GET  /api/status     - 获取当前状态`);
  console.log(`   - GET  /api/history    - 获取历史记录`);
  console.log(`   - POST /api/screenshot - 手动截屏`);
  console.log(`   - GET  /api/insights   - 获取优化建议`);
  console.log(`   - GET  /api/settings   - 获取设置`);
  console.log(`   - PUT  /api/settings   - 更新设置\n`);
});