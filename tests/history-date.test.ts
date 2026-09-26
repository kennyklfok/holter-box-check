import { describe, expect, it } from 'vitest';
import { historyDate } from '../src/client/history-date';

describe('Vancouver history dates', () => {
  it('uses the Vancouver date when UTC is already tomorrow', () => {
    expect(historyDate('2026-09-26T02:00:00Z', new Date('2026-09-26T03:00:00Z'))).toBe('Today');
    expect(historyDate('2026-09-25T02:00:00Z', new Date('2026-09-26T03:00:00Z'))).toBe('Yesterday');
  });
  it('handles the short spring daylight-saving day', () => {
    expect(historyDate('2026-03-08T08:30:00Z', new Date('2026-03-09T07:15:00Z'))).toBe('Yesterday');
  });
  it('handles the long autumn daylight-saving day', () => {
    expect(historyDate('2026-11-01T07:15:00Z', new Date('2026-11-02T08:30:00Z'))).toBe('Yesterday');
  });
  it('uses a full date for older and future checks', () => {
    expect(historyDate('2025-12-31T20:00:00Z', new Date('2026-09-25T20:00:00Z'))).toBe('December 31, 2025');
    expect(historyDate('2026-09-27T20:00:00Z', new Date('2026-09-25T20:00:00Z'))).toBe('September 27, 2026');
  });
});
