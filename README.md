# 🤖 WatchBot - AI 工作效率分析助手

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-Express.js-green?style=flat-square" alt="Tech Stack">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/GitHub-watchbot-orange?style=flat-square" alt="GitHub">
</p>

> ⚠️ **重要声明**：这是一个**个人效率分析工具**，用于自我复盘和工作习惯优化。**不是**用来监控员工的工具。

## 📋 目录

- [项目介绍](#项目介绍)
- [功能特性](#功能特性)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [API 接口](#api-接口)
- [数据库设计](#数据库设计)
- [前端页面](#前端页面)
- [配置说明](#配置说明)
- [开发指南](#开发指南)
- [路线图](#路线图)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 🎯 项目介绍

WatchBot 是一款 AI 工作效率分析应用，通过定时截屏和 AI 分析，帮助用户：

- 📊 **了解自己的工作状态** - 记录每天在做什么
- 🎯 **发现效率瓶颈** - 识别什么时候容易分心
- 💡 **获得优化建议** - 基于历史数据给出个性化建议
- 📈 **养成好习惯** - 通过数据反馈持续改进

### 适用场景

- 个人时间管理与效率复盘
- 远程办公自我监督
- 自由职业者工作记录
- 任何想了解自己工作模式的人

### 核心理念

> 数据是为了更好地了解自己，而不是束缚自己。

---

## ✨ 功能特性

### 核心功能

| 功能 | 描述 | 状态 |
|------|------|------|
| 定时截屏分析 | 每5秒自动分析当前工作状态 | ✅ |
| AI 状态识别 | 使用 GPT-4o Vision 分析截图 | ✅ |
| 专注度评估 | 评估工作专注程度 (0-100) | ✅ |
| 详细活动记录 | 记录具体活动、持续时间、产出 | ✅ |
| 会话总结 | 停止监控后自动生成工作汇总 | ✅ |
| 优化建议 | 基于历史数据给出个性化建议 | ✅ |
| 本地数据存储 | SQLite 本地数据库 | ✅ |
| 实时仪表盘 | 前端实时展示数据 | ✅ |

### 数据指标

- **Productivity (效率分数)**: 0-100，综合评估工作效率
- **Focus Score (专注度)**: 0-100，评估任务专注程度
- **Activity (活动类型)**: Coding、文档处理、会议、浏览等
- **Detail (详细描述)**: 15-30字的具体描述

---

## 🏗️ 技术架构

```
watchbot/
├── server/                 # Express.js 后端服务
│   ├── src/
│   │   └── index.js       # 主服务入口
│   ├── package.json
│   └── data/              # SQLite 数据库
│
├── client/                # Next.js 前端 (开发中)
│   ├── src/
│   │   ├── app/          # Next.js App Router
│   │   ├── components/   # UI 组件
│   │   └── lib/         # 工具函数
│   └── package.json
│
├── client-static/         # 静态前端 (生产可用)
│   └── index.html        # 单页应用
│
├── screenshots/           # 截图临时目录 (自动清理)
├── SPEC.md               # 项目规格文档
└── README.md             # 项目说明
```

### 技术栈

- **后端**: Express.js + Node.js
- **数据库**: SQLite (better-sqlite3)
- **AI 分析**: OpenAI GPT-4o Vision API
- **截屏**: screenshot-desktop
- **前端**: Vanilla HTML/CSS/JS / Next.js + shadcn/ui (开发中)
- **构建工具**: npm

---

## 🚀 快速开始

### 前置要求

- Node.js 18+
- npm 或 yarn
- (可选) OpenAI API Key (用于真实 AI 分析)

### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/kaychn126/watchbot.git
cd watchbot

# 2. 安装服务端依赖
cd server
npm install

# 3. (可选) 配置 OpenAI API Key
# Linux/Mac
export OPENAI_API_KEY=your_openai_api_key

# Windows (PowerShell)
$env:OPENAI_API_KEY="your_openai_api_key"

# 4. 启动服务端
npm start
# 或开发模式
npm run dev

# 5. 打开前端页面
# 方式1: 使用静态前端 (推荐)
cd ../client-static
# 用任意静态服务器打开 index.html
# 例如: npx serve .

# 方式2: 使用浏览器直接打开
# 直接用浏览器打开 client-static/index.html
```

### 服务地址

| 服务 | 地址 | 说明 |
|------|------|------|
| 后端 API | http://localhost:3001 | REST API |
| 静态前端 | http://localhost:3000 | Web 界面 |

### Docker 部署

```bash
# 构建镜像
docker build -t watchbot .

# 运行容器
docker run -d -p 3001:3001 -p 3000:3000 \
  -e OPENAI_API_KEY=your_key \
  watchbot
```

---

## 📡 API 接口

### 状态管理

| Method | Endpoint | 描述 |
|--------|----------|------|
| GET | `/api/status` | 获取当前监控状态 |
| GET | `/api/history` | 获取工作历史记录 |
| POST | `/api/screenshot` | 手动触发一次截屏分析 |
| GET | `/api/insights` | 获取优化建议和统计 |
| GET | `/api/settings` | 获取设置 |
| PUT | `/api/settings` | 更新设置 |

### 会话管理

| Method | Endpoint | 描述 |
|--------|----------|------|
| GET | `/api/sessions` | 获取历史会话总结 |
| PUT | `/api/settings` | `monitoring: true/false` 启动/停止监控 |

### 响应示例

#### GET /api/status
```json
{
  "monitoring": true,
  "lastCapture": "2026-03-10T10:30:00.000Z",
  "currentStatus": {
    "status": "高效工作",
    "activity": "Coding 🖥️",
    "productivity": 85,
    "focus_score": 88,
    "detail": "正在编写核心业务逻辑，已持续30分钟"
  },
  "totalRecords": 100,
  "lastSummary": {
    "summary": "本次工作 30 分钟，平均效率 82%，状态优秀！",
    "suggestions": "工作效率很高，保持当前状态"
  }
}
```

#### GET /api/insights
```json
{
  "insights": {
    "overall": "✨ 工作状态优秀！效率 85%，专注度 82%",
    "suggestions": [
      "🌅 上午黄金时间：建议处理复杂有挑战性的任务",
      "📈 主要活动： Coding (60%)"
    ],
    "trend": "up"
  },
  "stats": {
    "avgProductivity": 82,
    "avgFocus": 80,
    "todayRecords": 50,
    "totalHours": 4.2
  }
}
```

#### GET /api/sessions
```json
{
  "sessions": [
    {
      "id": 1,
      "start_time": "2026-03-10T09:00:00Z",
      "end_time": "2026-03-10T10:30:00Z",
      "duration_minutes": 90,
      "avg_productivity": 82,
      "avg_focus": 80,
      "main_activity": "Coding",
      "summary": "本次工作 90 分钟，平均效率 82%...",
      "suggestions": "保持当前状态"
    }
  ],
  "total": 5
}
```

---

## 💾 数据库设计

### 表: work_records (工作记录)

| 字段 | 类型 | 描述 |
|------|------|------|
| id | INTEGER | 主键 |
| status | TEXT | 工作状态 |
| activity | TEXT | 活动类型 |
| productivity | INTEGER | 效率分数 (0-100) |
| timestamp | TEXT | 时间戳 |
| detail | TEXT | 详细描述 |
| focus_score | INTEGER | 专注度分数 |
| created_at | TEXT | 创建时间 |

### 表: session_summary (会话总结)

| 字段 | 类型 | 描述 |
|------|------|------|
| id | INTEGER | 主键 |
| start_time | TEXT | 会话开始时间 |
| end_time | TEXT | 会话结束时间 |
| duration_minutes | INTEGER | 时长(分钟) |
| total_records | INTEGER | 记录数 |
| avg_productivity | INTEGER | 平均效率 |
| avg_focus | INTEGER | 平均专注度 |
| main_activity | TEXT | 主要活动 |
| summary | TEXT | 总结文案 |
| suggestions | TEXT | 改进建议 |

### 表: settings (设置)

| 字段 | 类型 | 描述 |
|------|------|------|
| key | TEXT | 设置键 |
| value | TEXT | 设置值 (JSON) |

---

## 🎨 前端页面

### 页面结构

1. **仪表盘** - 实时显示当前状态、效率评分、今日统计
2. **历史记录** - 查看完整的工作记录列表
3. **会话总结** - 查看历史会话的分析报告
4. **优化建议** - 查看 AI 生成的效率建议

### 界面预览

```
┌─────────────────────────────────────────────┐
│  🎯 WatchBot                    [📸 截屏]   │
│                                    [监控]⚪ │
├─────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ 当前状态  │ │ 效率评分  │ │ 今日记录 │   │
│  │ 高效工作  │ │   85/100 │ │   50条   │   │
│  │ Coding   │ │ ████░░░░ │ │ 效率:82% │   │
│  └──────────┘ └──────────┘ └──────────┘   │
├─────────────────────────────────────────────┤
│  [仪表盘] [历史记录] [会话总结] [优化建议]   │
├─────────────────────────────────────────────┤
│  最近活动                                   │
│  ● Coding    高效工作     10:30            │
│  ● 文档处理  普通工作     10:25            │
│  ● 会议      高效工作     10:20            │
└─────────────────────────────────────────────┘
```

---

## ⚙️ 配置说明

### 环境变量

| 变量 | 必填 | 描述 | 默认值 |
|------|------|------|--------|
| `PORT` | 否 | 服务端口 | 3001 |
| `OPENAI_API_KEY` | 否 | OpenAI API Key | 无 |

### 配置文件

服务启动时会自动创建:
- `server/data/watchbot.db` - SQLite 数据库
- `screenshots/` - 截图临时目录 (自动清理)

---

## 👨‍💻 开发指南

### 添加新功能

1. **修改服务端**
   - 编辑 `server/src/index.js`
   - 添加新的 API 路由
   - 更新数据库表结构

2. **修改前端**
   - 编辑 `client-static/index.html`
   - 或在 `client/` 中使用 Next.js 开发

3. **测试**
   ```bash
   # 启动服务
   cd server && npm start
   
   # 测试 API
   curl http://localhost:3001/api/health
   curl -X POST http://localhost:3001/api/screenshot
   ```

### 代码规范

- 使用 ES6+ 语法
- API 返回 JSON 格式
- 数据库使用 prepared statements 防止 SQL 注入

---

## 📅 路线图

### v1.0 (已完成)
- [x] 定时截屏分析
- [x] AI 状态识别
- [x] SQLite 数据存储
- [x] 静态前端界面
- [x] 会话总结

### v1.1 (计划中)
- [ ] Next.js 前端美化
- [ ] 数据导出功能
- [ ] 支持更多 AI 模型

### v2.0 (未来)
- [ ] 多语言支持
- [ ] WebSocket 实时推送
- [ ] 数据可视化报表

---

## 🤝 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/xxx`)
3. 提交更改 (`git commit -m 'Add xxx'`)
4. 推送到分支 (`git push origin feature/xxx`)
5. 创建 Pull Request

### 贡献者

| 贡献者 | 角色 |
|--------|------|
| watchbot | 初始开发 |

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [OpenAI](https://openai.com/) - GPT-4o Vision API
- [Instreet](https://instreet.coze.site/) - AI Agent 社区
- 所有测试和使用本项目的用户

---

<p align="center">
  <sub>Built with ❤️ by WatchBot</sub>
</p>