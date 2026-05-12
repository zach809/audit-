import { APP_TZ } from "./config";

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hour12: false,
});

export function localParts(date: Date): LocalParts {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: String(parts.weekday),
  };
}

function partsAsUtcMillis(parts: Pick<LocalParts, "year" | "month" | "day" | "hour" | "minute" | "second">) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const actual = localParts(guess);
  const desiredMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  const actualMillis = partsAsUtcMillis(actual);
  return new Date(guess.getTime() + (desiredMillis - actualMillis));
}

export function isBusinessDay(date: Date): boolean {
  const weekday = localParts(date).weekday;
  return weekday !== "Sat" && weekday !== "Sun";
}

function addLocalDays(date: Date, days: number): Date {
  const p = localParts(date);
  return zonedDateTimeToUtc(p.year, p.month, p.day + days, p.hour, p.minute, p.second);
}

function atLocalTime(date: Date, hour: number, minute = 0): Date {
  const p = localParts(date);
  return zonedDateTimeToUtc(p.year, p.month, p.day, hour, minute, 0);
}

export function nextBusinessStart(date: Date): Date {
  let candidate = atLocalTime(addLocalDays(date, 1), 8);
  while (!isBusinessDay(candidate)) {
    candidate = atLocalTime(addLocalDays(candidate, 1), 8);
  }
  return candidate;
}

export function effectiveIntake(createdAt: Date): Date {
  const p = localParts(createdAt);
  const sameDayStart = atLocalTime(createdAt, 8);
  const sameDayEnd = atLocalTime(createdAt, 17);

  if (!isBusinessDay(createdAt)) {
    let candidate = sameDayStart;
    while (!isBusinessDay(candidate)) {
      candidate = atLocalTime(addLocalDays(candidate, 1), 8);
    }
    return candidate;
  }
  if (p.hour < 8) return sameDayStart;
  if (createdAt >= sameDayEnd) return nextBusinessStart(createdAt);
  return createdAt;
}

export function addBusinessMinutes(start: Date, minutes: number): Date {
  let remaining = minutes;
  let cursor = effectiveIntake(start);
  while (remaining > 0) {
    const end = atLocalTime(cursor, 17);
    const available = Math.max(0, Math.floor((end.getTime() - cursor.getTime()) / 60000));
    if (remaining <= available) {
      return new Date(cursor.getTime() + remaining * 60000);
    }
    remaining -= available;
    cursor = nextBusinessStart(cursor);
  }
  return cursor;
}

export function businessDayEnd(date: Date): Date {
  let candidate = atLocalTime(date, 17);
  while (!isBusinessDay(candidate)) {
    candidate = atLocalTime(addLocalDays(candidate, 1), 17);
  }
  return candidate;
}

export function addBusinessDaysDeadline(anchor: Date, businessDaysAfter: number): Date {
  let cursor = anchor;
  let remaining = businessDaysAfter;
  while (remaining > 0) {
    cursor = addLocalDays(cursor, 1);
    if (isBusinessDay(cursor)) remaining -= 1;
  }
  return businessDayEnd(cursor);
}

export function setupDeadlines(createdAt: Date) {
  const effective = effectiveIntake(createdAt);
  const onTime = addBusinessMinutes(effective, 60);
  return {
    effective,
    onTime,
    corrective: businessDayEnd(onTime),
  };
}

export function formatLocal(date: Date | string | null | undefined): string {
  if (!date) return "";
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function isoDate(date: Date): string {
  return date.toISOString();
}
