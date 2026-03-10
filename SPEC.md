# WatchBot - AI 工作状态监控应用

## 项目概述
- **项目名称**: WatchBot
- **类型**: Web 应用 (前后端分离)
- **核心功能**: 通过定时截屏监控用户工作状态，AI 分析并提供优化建议
- **目标用户**: 需要提高工作效率的专业人士

## 技术栈
- **前端**: Next.js 14 (App Router) + shadcn/ui + Tailwind CSS
- **后端**: Express.js + Node.js
- **数据库**: 内存存储 (可扩展为 SQLite/PostgreSQL)
- **截图工具**: node-screenshot 或 native 截屏

## 功能列表

### 服务端
1. **定时截屏**: 每隔一定周期自动截屏
2. **状态分析**: 基于图像识别分析工作状态（可接入 AI API）
3. **工作记录存储**: 保存历史记录
4. **API 接口**: 提供 RESTful API 给前端

### 前端
1. **仪表盘**: 展示当前工作状态概览
2. **历史记录**: 查看历史工作状态
3. **统计分析**: 工作时间段分布图表
4. **优化建议**: AI 给出的建议展示

## 页面结构

### 前端页面
- `/` - 首页/仪表盘
- `/history` - 历史记录
- `/analytics` - 数据分析
- `/settings` - 设置页面

## API 设计

### 状态相关
- `GET /api/status` - 获取当前状态
- `GET /api/history` - 获取历史记录
- `POST /api/screenshot` - 手动触发截屏
- `GET /api/insights` - 获取优化建议

### 设置相关
- `GET /api/settings` - 获取设置
- `PUT /api/settings` - 更新设置

## 验收标准
1. 服务端可以持续运行并定时截屏
2. 前端可以查看当前状态和历史记录
3. 展示 AI 优化建议
4. 本地部署测试通过