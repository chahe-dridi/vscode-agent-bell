import { getConfig } from './config';

type QuietHours = { start: number; end: number };

function parseTime(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) { return undefined; }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) { return undefined; }
  return hours * 60 + minutes;
}

export function getQuietHours(): QuietHours | undefined {
  const config = getConfig();
  const startValue = config.get<string>('quietHoursStart', '').trim();
  const endValue = config.get<string>('quietHoursEnd', '').trim();
  if (!startValue || !endValue) { return undefined; }

  const start = parseTime(startValue);
  const end = parseTime(endValue);
  if (start === undefined || end === undefined || start === end) { return undefined; }
  return { start, end };
}

export function isQuietHoursActive(now = new Date()): boolean {
  const quietHours = getQuietHours();
  if (!quietHours) { return false; }

  const current = now.getHours() * 60 + now.getMinutes();
  const { start, end } = quietHours;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}
