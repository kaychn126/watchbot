const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }
  
  return response.json();
}

export interface WorkRecord {
  status: string;
  activity: string;
  productivity: number;
  timestamp: string;
  screenshot?: string | null;
}

export interface Insights {
  overall: string;
  suggestions: string[];
  trend: 'up' | 'stable' | 'down';
}

export interface Stats {
  totalHours: number;
  avgProductivity: number;
  todayRecords: number;
}

export interface Settings {
  captureInterval: number;
  monitoring: boolean;
  lastCapture: string | null;
}

export const api = {
  // 获取当前状态
  getStatus: () => fetchJson<{
    monitoring: boolean;
    lastCapture: string | null;
    currentStatus: WorkRecord | null;
    totalRecords: number;
  }>('/status'),
  
  // 获取历史记录
  getHistory: (limit = 50, offset = 0) => fetchJson<{
    records: WorkRecord[];
    total: number;
    limit: number;
    offset: number;
  }>(`/history?limit=${limit}&offset=${offset}`),
  
  // 手动截屏
  triggerScreenshot: () => fetchJson<{ success: boolean; data: WorkRecord }>('/screenshot', {
    method: 'POST',
  }),
  
  // 获取优化建议
  getInsights: () => fetchJson<{ insights: Insights; stats: Stats }>('/insights'),
  
  // 获取设置
  getSettings: () => fetchJson<Settings>('/settings'),
  
  // 更新设置
  updateSettings: (data: Partial<Settings>) => 
    fetchJson<{ success: boolean; settings: Settings }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  // 健康检查
  healthCheck: () => fetchJson<{ status: string; timestamp: string }>('/health'),
};