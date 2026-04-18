// 开发环境用 localhost:3001，生产环境通过 Nginx 代理用相对路径 /api
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

// ========== Token 管理 ==========

export function getToken(): string | null {
  return localStorage.getItem('token');
}

export function setToken(token: string) {
  localStorage.setItem('token', token);
}

export function removeToken() {
  localStorage.removeItem('token');
}

export function getUser(): any {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
}

export function setUser(user: any) {
  localStorage.setItem('user', JSON.stringify(user));
}

export function removeUser() {
  localStorage.removeItem('user');
}

export function logout() {
  removeToken();
  removeUser();
  window.location.href = '/login';
}

// ========== 请求封装 ==========

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 如果不是 FormData，设置 Content-Type
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json();

  if (res.status === 401) {
    logout();
    throw new Error('登录已过期，请重新登录');
  }

  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }

  return data;
}

// ========== 认证接口 ==========

export async function apiRegister(phone: string, password: string, nickname?: string) {
  const data = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone, password, nickname }),
  });
  setToken(data.data.token);
  setUser(data.data);
  return data;
}

export async function apiLogin(phone: string, password: string) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  setToken(data.data.token);
  setUser(data.data);
  return data;
}

export async function apiGetMe() {
  return request('/auth/me');
}

// ========== OCR 识别接口 ==========

export async function apiRecognizeInvoice(file: File, batchId: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('batchId', batchId);

  return request('/ocr/recognize', {
    method: 'POST',
    body: formData,
  });
}

// ========== 发票历史接口 ==========

export interface InvoiceQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  dateRange?: string;
  startDate?: string;
  endDate?: string;
}

export async function apiGetInvoices(query: InvoiceQuery = {}) {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.keyword) params.set('keyword', query.keyword);
  if (query.status) params.set('status', query.status);
  if (query.dateRange) params.set('dateRange', query.dateRange);
  if (query.startDate) params.set('startDate', query.startDate);
  if (query.endDate) params.set('endDate', query.endDate);

  return request(`/invoices?${params.toString()}`);
}

export async function apiGetInvoiceDetail(id: number) {
  return request(`/invoices/${id}`);
}

export async function apiUpdateInvoice(id: number, data: any) {
  return request(`/invoices/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function apiDeleteInvoice(id: number) {
  return request(`/invoices/${id}`, {
    method: 'DELETE',
  });
}

export async function apiBatchDeleteInvoices(ids: number[]) {
  return request('/invoices/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function apiExportInvoices(ids?: number[]) {
  const params = ids ? `?ids=${ids.join(',')}` : '';
  return request(`/invoices/export/excel${params}`);
}