import { shanghaiWeekStart, WEEK_SECONDS } from './week.util';

describe('Off-chain dividend week boundaries', () => {
  const monday = 1794153600; // 2026-11-09 00:00 Asia/Shanghai
  it.each([
    [monday - 1, monday - WEEK_SECONDS],
    [monday, monday],
    [monday + 2 * 86400, monday],
    [monday + WEEK_SECONDS - 1, monday],
    [monday + WEEK_SECONDS, monday + WEEK_SECONDS],
  ])('assigns block timestamp %s to week %s', (timestamp, expected) => {
    expect(shanghaiWeekStart(timestamp)).toBe(expected);
  });
});
