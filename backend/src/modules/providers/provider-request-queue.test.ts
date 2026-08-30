import {
  fetchWithProviderPolicy,
  resetProviderRequestQueuesForTests,
  retryAfterMilliseconds,
} from './provider-request-queue';

describe('provider request queue', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetProviderRequestQueuesForTests();
  });

  it('parses Retry-After seconds and dates', () => {
    expect(retryAfterMilliseconds('2', 1_000)).toBe(2_000);
    expect(retryAfterMilliseconds(new Date(6_000).toUTCString(), 1_000)).toBe(5_000);
    expect(retryAfterMilliseconds('not-a-date', 1_000)).toBeNull();
  });

  it('retries a provider-wide 429 response', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const response = await fetchWithProviderPolicy(
      'test',
      'https://example.test',
      {},
      {
        maxRetries: 1,
        retryBaseMs: 50,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a transient network failure', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const response = await fetchWithProviderPolicy(
      'network-test',
      'https://example.test',
      {},
      {
        maxRetries: 1,
        retryBaseMs: 50,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
