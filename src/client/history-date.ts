const calendarFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
});
const fullDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver', year: 'numeric', month: 'long', day: 'numeric',
});

function calendarDay(date: Date): number {
  const parts = calendarFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find(part => part.type === type)!.value);
  return Date.UTC(value('year'), value('month') - 1, value('day')) / 86_400_000;
}

export function historyDate(utc: string, now = new Date()): string {
  const date = new Date(utc);
  // Compare Vancouver calendar days, including days with daylight-saving changes.
  const daysAgo = calendarDay(now) - calendarDay(date);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return fullDateFormatter.format(date);
}
