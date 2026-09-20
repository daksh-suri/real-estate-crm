import { describe, test, expect } from 'vitest';
import { formatDateTime, formatDate, shortId, prettifyEnum, formatMoney } from '../../lib/format';
import { validLeadTransitions } from '../../lib/leadWorkflow';

describe('slice formatting', () => {
  test('dates render or fall back to an em dash', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDateTime('2026-09-20T10:00:00.000Z')).not.toBe('—');
    expect(formatDate('2026-09-20T10:00:00.000Z')).not.toBe('—');
  });

  test('shortId truncates, prettifyEnum underscores', () => {
    expect(shortId('12345678-abcd')).toBe('12345678');
    expect(shortId(null)).toBe('—');
    expect(prettifyEnum('SITE_VISIT_SCHEDULED')).toBe('SITE VISIT SCHEDULED');
    expect(prettifyEnum(null)).toBe('—');
  });

  test('formatMoney handles Decimal strings and nulls', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('5000000.00')).toContain('50,00,000');
  });
});

describe('lead transition map (mirrors backend ALLOWED_TRANSITIONS)', () => {
  test('only valid targets are offered; CONVERTED is terminal', () => {
    expect(validLeadTransitions('OPEN')).toEqual(['CONVERTED', 'DISQUALIFIED']);
    expect(validLeadTransitions('DISQUALIFIED')).toEqual(['OPEN']);
    expect(validLeadTransitions('CONVERTED')).toEqual([]);
    expect(validLeadTransitions('ANYTHING_ELSE')).toEqual([]);
  });
});
