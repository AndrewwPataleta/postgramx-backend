import { DEFAULT_TIMEZONE } from './time.constants';

type DateInput = string | Date;

const DATE_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

const safeDate = (isoOrDate: DateInput): Date => {
  if (isoOrDate instanceof Date) {
    return isoOrDate;
  }
  return new Date(isoOrDate);
};

const getPartsMap = (date: Date, timeZone: string): Record<string, string> => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...DATE_PARTS,
    timeZone,
  }).formatToParts(date);

  return parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
};

export const isValidIanaTimeZone = (tz: string): boolean => {
  if (!tz || typeof tz !== 'string') {
    return false;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export const getUserTimeZone = (
  user?: { timeZone?: string | null } | null,
): string => {
  const tz = user?.timeZone?.trim();
  if (!tz || !isValidIanaTimeZone(tz)) {
    return DEFAULT_TIMEZONE;
  }
  return tz;
};

export const formatUtc = (isoOrDate: DateInput, _pattern?: string): string => {
  const date = safeDate(isoOrDate);
  const parts = getPartsMap(date, 'UTC');
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} UTC`;
};

export const formatInTimeZone = (
  isoOrDate: DateInput,
  tz: string,
  _pattern?: string,
): string => {
  const date = safeDate(isoOrDate);
  const timeZone = isValidIanaTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  const parts = getPartsMap(date, timeZone);
  const offset = new Intl.DateTimeFormat('en-US', {
    ...DATE_PARTS,
    timeZone,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${offset ?? 'UTC'}`;
};

export const buildDisplayTime = (isoOrDate: DateInput, tz?: string | null) => {
  const timeZone = isValidIanaTimeZone(tz ?? '')
    ? (tz as string)
    : DEFAULT_TIMEZONE;
  return {
    utc: formatUtc(isoOrDate),
    local: formatInTimeZone(isoOrDate, timeZone),
    timeZone,
  };
};
