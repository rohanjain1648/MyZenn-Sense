import { describe, expect, it } from 'vitest';
import { decodeInsight, encodeInsight, reflectionPrompt, wellnessOnly } from './insight';

describe('Insight protobuf', () => {
  it('round-trips an analysis', () => {
    const buf = encodeInsight({ requestId: 42, processedAt: '2026-11-12T10:00:00Z', analysis: 'Your breathing settled nicely.', type: 1 });
    expect(decodeInsight(buf)).toEqual({
      requestId: 42,
      processedAt: '2026-11-12T10:00:00Z',
      analysis: 'Your breathing settled nicely.',
      error: null,
      type: 1,
    });
  });

  it('round-trips an error result and non-ASCII text', () => {
    const decoded = decodeInsight(encodeInsight({ requestId: 300, error: 'Crédits épuisés' }));
    expect(decoded.requestId).toBe(300);
    expect(decoded.error).toBe('Crédits épuisés');
    expect(decoded.analysis).toBeNull();
  });

  it('decodes hand-written wire bytes (request_id=7, analysis="ok")', () => {
    const bytes = new Uint8Array([0x08, 0x07, 0x1a, 0x02, 0x6f, 0x6b]);
    expect(decodeInsight(bytes)).toMatchObject({ requestId: 7, analysis: 'ok' });
  });

  it('rejects a truncated buffer instead of returning garbage', () => {
    expect(() => decodeInsight(new Uint8Array([0x1a, 0x05, 0x6f]))).toThrow();
  });
});

describe('reflectionPrompt', () => {
  it('stays within the measured data, asks for wellness only, and fits the 2048-byte limit', () => {
    const prompt = reflectionPrompt({ minutes: 4.4, breathingBefore: 14.2, breathingAfter: 6.8 });
    expect(prompt).toContain('14 to 7 breaths per minute');
    expect(prompt).toMatch(/no medical advice/);
    expect(new TextEncoder().encode(prompt).length).toBeLessThan(2048);
  });
});

describe('wellnessOnly', () => {
  it('keeps a calm wellness reflection', () => {
    const text = 'Your breathing slowed beautifully. Your heart rhythm looks steady and relaxed.';
    expect(wellnessOnly(text)).toBe(text);
  });

  it('drops model-added disclaimers but keeps the reflection', () => {
    expect(wellnessOnly('Your pulse eased as you slowed down. This is not medical advice.')).toBe('Your pulse eased as you slowed down.');
  });

  it.each([
    'Your pulse suggests possible tachycardia.',
    'You should consult your doctor about this heart rate.',
    'This could be a symptom of anxiety.',
    'Your HRV looks abnormal for your age.',
    'This may indicate high blood pressure.',
  ])('hides medical statements: %s', (text) => {
    expect(wellnessOnly(text)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(wellnessOnly('')).toBeNull();
    expect(wellnessOnly(null)).toBeNull();
  });
});
