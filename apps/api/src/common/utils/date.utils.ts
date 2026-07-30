import { BadRequestException } from '@nestjs/common';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function currentDateInTimeZone(
  value: Date,
  timeZone = process.env.DEFAULT_TIME_ZONE || 'America/Sao_Paulo',
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function parseDateOnly(value?: string, fallback = new Date()): Date {
  if (!value) {
    return new Date(`${currentDateInTimeZone(fallback)}T00:00:00.000Z`);
  }

  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new BadRequestException('A data deve estar no formato YYYY-MM-DD.');
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Data inválida.');
  }
  return parsed;
}

export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function dayWindow(value: string): { start: Date; end: Date } {
  const start = parseDateOnly(value);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
