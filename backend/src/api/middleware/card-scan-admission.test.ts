import sharp from 'sharp';

import {
  CardScanAdmissionGate,
  CardScanImageValidationError,
  validateCardScanImage,
} from './card-scan-admission';

describe('CardScanAdmissionGate', () => {
  test('enforces per-user concurrency without consuming rejected rate capacity', () => {
    let now = 1_000;
    const gate = new CardScanAdmissionGate({
      windowMs: 60_000,
      maxRequestsPerWindow: 2,
      maxConcurrentGlobal: 4,
      maxConcurrentPerUser: 1,
      now: () => now,
    });

    const first = gate.enter('user:one');
    expect(first.allowed).toBe(true);
    expect(gate.enter('user:one')).toMatchObject({
      allowed: false,
      reason: 'concurrency',
    });
    if (first.allowed) first.lease.release();

    const second = gate.enter('user:one');
    expect(second.allowed).toBe(true);
    if (second.allowed) second.lease.release();

    expect(gate.enter('user:one')).toMatchObject({
      allowed: false,
      reason: 'rate-limit',
    });

    now += 60_000;
    const nextWindow = gate.enter('user:one');
    expect(nextWindow.allowed).toBe(true);
    if (nextWindow.allowed) nextWindow.lease.release();
  });

  test('enforces the global concurrency ceiling across users', () => {
    const gate = new CardScanAdmissionGate({
      windowMs: 60_000,
      maxRequestsPerWindow: 10,
      maxConcurrentGlobal: 1,
      maxConcurrentPerUser: 1,
    });
    const first = gate.enter('user:one');
    expect(first.allowed).toBe(true);
    expect(gate.enter('user:two')).toMatchObject({
      allowed: false,
      reason: 'concurrency',
    });
    if (first.allowed) first.lease.release();
  });
});

describe('validateCardScanImage', () => {
  test('accepts a supported image within the decoded pixel budget', async () => {
    const image = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();

    await expect(validateCardScanImage(image, 100)).resolves.toBeUndefined();
  });

  test('rejects input that is not a decodable image', async () => {
    await expect(validateCardScanImage(Buffer.from('not an image'), 100)).rejects.toBeInstanceOf(
      CardScanImageValidationError,
    );
  });

  test('rejects images over the decoded pixel budget', async () => {
    const image = await sharp({
      create: { width: 11, height: 10, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    await expect(validateCardScanImage(image, 100)).rejects.toMatchObject({ statusCode: 413 });
  });
});
