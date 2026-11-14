import { apiRequest } from './api';

export const NOTICE_CATEGORIES = ['AGM', 'SGM', 'MAINTENANCE', 'EMERGENCY', 'WATER', 'SECURITY', 'REPAIRS', 'GENERAL', 'OTHER'] as const;
export type NoticeCategory = typeof NOTICE_CATEGORIES[number];

export type NoticeRecord = {
  _id: string;
  societyId: string;
  title: string;
  description: string;
  category: NoticeCategory;
  priority: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt?: string;
  expiresAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  attachmentIds: string[];
  meetingId?: string;
  projectId?: string;
};

export type NoticeList = { items: NoticeRecord[]; page: number; limit: number; total: number };
export type NoticeInput = {
  title: string;
  description: string;
  category: NoticeCategory;
  priority: string;
  expiresAt?: string | null;
};

export function listNotices(token: string, filters: { societyId?: string; category?: string; status?: string; page?: number; limit?: number } = {}) {
  const query = new URLSearchParams();
  for (const key of ['societyId', 'category', 'status', 'page', 'limit'] as const) {
    const value = filters[key];
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.size ? `?${query.toString()}` : '';
  return apiRequest<NoticeList>(`/notices${suffix}`, { token });
}

export function createNotice(token: string, input: NoticeInput) {
  return apiRequest<NoticeRecord>('/notices', { token, method: 'POST', body: JSON.stringify(input) });
}

export function updateNoticeDraft(token: string, noticeId: string, input: Partial<NoticeInput>) {
  return apiRequest<NoticeRecord>(`/notices/${encodeURIComponent(noticeId)}`, { token, method: 'PATCH', body: JSON.stringify(input) });
}

export function publishNotice(token: string, noticeId: string) {
  return apiRequest<NoticeRecord>(`/notices/${encodeURIComponent(noticeId)}/publish`, { token, method: 'POST', body: '{}' });
}

export function archiveNotice(token: string, noticeId: string) {
  return apiRequest<NoticeRecord>(`/notices/${encodeURIComponent(noticeId)}/archive`, { token, method: 'POST', body: '{}' });
}
