import type { CollectionValueHistory, CollectionValueBreakdown, CollectionDistribution } from '@tcg/api-types';
import { API_BASE_URL } from './base-url';

export type { CollectionValueHistory, CollectionValueBreakdown, CollectionDistribution };

async function authFetch(url: string, token: string) {
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Request failed');
  }
  return res.json();
}

export async function getCollectionValueHistory(token: string, period = '30d'): Promise<CollectionValueHistory> {
  return authFetch(`${API_BASE_URL}/analytics/value?period=${period}`, token);
}

export async function getCollectionValueBreakdown(token: string): Promise<CollectionValueBreakdown> {
  return authFetch(`${API_BASE_URL}/analytics/value/breakdown`, token);
}

export async function getCollectionDistribution(token: string, dimension: string): Promise<CollectionDistribution> {
  return authFetch(`${API_BASE_URL}/analytics/distribution?by=${dimension}`, token);
}
