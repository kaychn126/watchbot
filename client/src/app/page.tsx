'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  Camera,
  Clock,
  Lightbulb,
  RefreshCw,
  Play,
  Square
} from 'lucide-react';
import { api, WorkRecord, Insights, Stats } from '@/lib/api';

function getStatusColor(status: string) {
  switch (status) {
    case '高效工作': return 'text-green-500';
    case '普通工作': return 'text-blue-500';
    case '轻微分心': return 'text-yellow-500';
    case '休息中': return 'text-gray-500';
    default: return 'text-gray-500';
  }
}

function getStatusBg(status: string) {
  switch (status) {
    case '高效工作': return 'bg-green-500';
    case '普通工作': return 'bg-blue-500';
    case '轻微分心': return 'bg-yellow-500';
    case '休息中': return 'bg-gray-500';
    default: return 'bg-gray-500';
  }
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [monitoring, setMonitoring] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<WorkRecord | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<WorkRecord[]>([]);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const fetchData = async () => {
    try {
      const [statusData, insightsData, historyData] = await Promise.all([
        api.getStatus(),
        api.getInsights(),
        api.getHistory(20)
      ]);
      
      setMonitoring(statusData.monitoring);
      setCurrentStatus(statusData.currentStatus);
      setLastCapture(statusData.lastCapture);
      setInsights(insightsData.insights);
      setStats(insightsData.stats);
      setHistory(historyData.records);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggleMonitoring = async () => {
    try {
      await api.updateSettings({ monitoring: !monitoring });
      setMonitoring(!monitoring);
    } catch (error) {
      console.error('Failed to toggle monitoring:', error);
    }
  };

  const handleCapture = async () => {
    setCapturing(true);
    try {
      await api.triggerScreenshot();
      await fetchData();
    } catch (error) {
      console.error('Failed to capture:', error);
    } finally {
      setCapturing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <Skeleton className="h-12 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-40" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Activity className="w-8 h-8 text-emerald-400" />
              WatchBot
            </h1>
            <p className="text-slate-400 mt-1">AI 工作状态监控与分析</p>
          </div>
          <div className="flex items-center gap-4">
            <Button 
              onClick={handleCapture}
              disabled={capturing}
              variant="outline"
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              <Camera className={`w-4 h-4 mr-2 ${capturing ? 'animate-pulse' : ''}`} />
              {capturing ? '截屏中...' : '立即截屏'}
            </Button>
            <div className="flex items-center gap-3 bg-slate-800 px-4 py-2 rounded-lg">
              <span className="text-slate-300 text-sm">
                {monitoring ? '监控中' : '已暂停'}
              </span>
              <Switch 
                checked={monitoring} 
                onCheckedChange={toggleMonitoring}
              />
            </div>
          </div>
        </div>

        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="bg-slate-800 border-slate-700">
            <TabsTrigger value="dashboard" className="text-slate-300 data-[state=active]:bg-slate-700">
              仪表盘
            </TabsTrigger>
            <TabsTrigger value="history" className="text-slate-300 data-[state=active]:bg-slate-700">
              历史记录
            </TabsTrigger>
            <TabsTrigger value="insights" className="text-slate-300 data-[state=active]:bg-slate-700">
              优化建议
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <CardDescription className="text-slate-400">当前状态</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${getStatusColor(currentStatus?.status || '')}`}>
                    {currentStatus?.status || '等待数据'}
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    {currentStatus?.activity || '-'}
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <CardDescription className="text-slate-400">效率评分</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-white">
                    {currentStatus?.productivity || 0}
                    <span className="text-sm text-slate-500 font-normal">/100</span>
                  </div>
                  <Progress 
                    value={currentStatus?.productivity || 0} 
                    className="mt-2 h-2"
                  />
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <CardDescription className="text-slate-400">今日记录</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-white">
                    {stats?.todayRecords || 0}
                    <span className="text-sm text-slate-500 font-normal"> 条</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    共 {stats?.avgProductivity || 0}% 平均效率
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <CardDescription className="text-slate-400">最后截屏</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {lastCapture 
                      ? new Date(lastCapture).toLocaleTimeString('zh-CN')
                      : '尚未截屏'
                    }
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    共 {stats?.totalHours?.toFixed(1) || 0} 小时数据
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Recent History */}
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">最近活动</CardTitle>
                <CardDescription className="text-slate-400">最近的工作状态记录</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {history.length === 0 ? (
                    <p className="text-slate-500 text-center py-8">暂无记录</p>
                  ) : (
                    history.slice().reverse().slice(0, 8).map((record, i) => (
                      <div 
                        key={i} 
                        className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${getStatusBg(record.status)}`} />
                          <span className="text-white">{record.activity}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className={`font-medium ${getStatusColor(record.status)}`}>
                            {record.status}
                          </span>
                          <span className="text-slate-400 text-sm">
                            {new Date(record.timestamp).toLocaleTimeString('zh-CN')}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">历史记录</CardTitle>
                <CardDescription className="text-slate-400">完整的工作状态历史</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {history.length === 0 ? (
                    <p className="text-slate-500 text-center py-8">暂无记录</p>
                  ) : (
                    history.slice().reverse().map((record, i) => (
                      <div 
                        key={i} 
                        className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg hover:bg-slate-700/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${getStatusBg(record.status)}`} />
                          <span className="text-white">{record.activity}</span>
                        </div>
                        <div className="flex items-center gap-6">
                          <span className="text-slate-400 text-sm">
                            效率: {record.productivity}%
                          </span>
                          <span className={`font-medium ${getStatusColor(record.status)}`}>
                            {record.status}
                          </span>
                          <span className="text-slate-400 text-sm">
                            {new Date(record.timestamp).toLocaleString('zh-CN')}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="insights" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Overall Assessment */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-yellow-400" />
                    整体评估
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3 mb-4">
                    {insights?.trend === 'up' && <TrendingUp className="w-8 h-8 text-green-400" />}
                    {insights?.trend === 'down' && <TrendingDown className="w-8 h-8 text-red-400" />}
                    {insights?.trend === 'stable' && <Minus className="w-8 h-8 text-blue-400" />}
                    <div>
                      <div className="text-2xl font-bold text-white">{insights?.overall}</div>
                      <div className="text-sm text-slate-400">
                        趋势: {insights?.trend === 'up' ? '上升 ↗' : insights?.trend === 'down' ? '下降 ↘' : '稳定 →'}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-slate-400">效率评分</div>
                    <Progress value={stats?.avgProductivity || 0} className="h-3" />
                    <div className="text-right text-sm text-slate-400">{stats?.avgProductivity || 0}%</div>
                  </div>
                </CardContent>
              </Card>

              {/* Suggestions */}
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-emerald-400" />
                    优化建议
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {insights?.suggestions.length === 0 ? (
                      <p className="text-slate-500">收集更多数据以获得建议</p>
                    ) : (
                      insights?.suggestions.map((suggestion, i) => (
                        <div 
                          key={i} 
                          className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300"
                        >
                          {suggestion}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}