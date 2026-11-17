import { AnalyticsError } from "./errors";

export type AnalyticsRange = "today" | "yesterday" | "7d" | "30d" | "custom";

export interface DateRangeResult {
  range: AnalyticsRange;
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
  timeZone: string;
}

const DEFAULT_RANGE: AnalyticsRange = "7d";
const DEFAULT_TIME_ZONE = "UTC";

const VALID_RANGES: readonly AnalyticsRange[] = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "custom",
];

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return false;
  }

  const isLeapYear =
    year % 400 === 0 ||
    (year % 4 === 0 && year % 100 !== 0);

  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1];
}

/**
 * 验证 IANA 时区名称是否合法。
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取给定时刻在指定时区的本地日历日期。
 */
function getLocalDateParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string): number =>
    Number(
      parts.find((part) => part.type === type)?.value ?? "",
    );

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

/**
 * 获取给定时刻在指定时区的本地时分秒。
 */
function getLocalTimeParts(
  date: Date,
  timeZone: string,
): { hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string): number =>
    Number(
      parts.find((part) => part.type === type)?.value ?? "",
    );

  return {
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * 比较两个本地日期（年、月、日）。
 */
function compareLocalDate(
  a: { year: number; month: number; day: number },
  b: { year: number; month: number; day: number },
): number {
  if (a.year !== b.year) {
    return a.year < b.year ? -1 : 1;
  }
  if (a.month !== b.month) {
    return a.month < b.month ? -1 : 1;
  }
  return a.day < b.day ? -1 : a.day > b.day ? 1 : 0;
}

/**
 * 计算指定本地日期在指定时区的午夜（00:00:00）对应的 UTC 时间戳。
 *
 * 策略：
 * 1. 从目标日期前两天的 UTC 00:00 开始，确保早于所有时区的本地午夜。
 * 2. 逐小时向前推进，找到首个本地时间为目标日期 00:00:00 的瞬时。
 *
 * 逐小时向前并返回首个匹配，能正确处理 DST 秋季回拨导致的
 * 本地午夜出现两次的情况（返回第一个，即夏令时偏移对应的午夜）。
 * 极端情况下若本地午夜不存在，返回该日期内的首个有效本地时刻。
 *
 * 这种方式避免固定 24 小时计算，正确处理 DST。
 */
function localMidnightUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const target: { year: number; month: number; day: number } = {
    year,
    month,
    day,
  };

  // 从目标日期前两天的 UTC 00:00 开始，确保早于所有时区的本地午夜。
  let candidate = Date.UTC(year, month - 1, day - 2, 0, 0, 0);
  let firstOfDay: number | null = null;

  // 最多遍历 3 天的每个小时（72 小时），足以覆盖跨时区日期边界。
  for (let i = 0; i < 73; i++) {
    const date = new Date(candidate);
    const local = getLocalDateParts(date, timeZone);

    if (compareLocalDate(local, target) === 0) {
      if (firstOfDay === null) {
        firstOfDay = candidate;
      }

      const { hour, minute, second } = getLocalTimeParts(date, timeZone);

      if (hour === 0 && minute === 0 && second === 0) {
        return candidate;
      }
    } else if (firstOfDay !== null) {
      // 已越过目标日期，若之前未找到精确午夜，返回首个有效时刻。
      return firstOfDay;
    }

    candidate += HOUR_MS;
  }

  return firstOfDay ?? candidate;
}

/**
 * 在日历日期上加减天数（基于 UTC，不受 DST 影响）。
 */
function addCalendarDays(
  year: number,
  month: number,
  day: number,
  offsetDays: number,
): { year: number; month: number; day: number } {
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays);

  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

/**
 * 获取“今天”在指定时区的本地日期。
 */
function getTodayLocalDate(timeZone: string) {
  return getLocalDateParts(new Date(), timeZone);
}

/**
 * 计算预设范围的 [start, end) UTC 边界。
 */
function computePresetRange(
  range: AnalyticsRange,
  timeZone: string,
): { start: Date; end: Date } {
  const today = getTodayLocalDate(timeZone);

  let startLocal: { year: number; month: number; day: number };
  let endLocal: { year: number; month: number; day: number };

  switch (range) {
    case "today":
      startLocal = today;
      endLocal = addCalendarDays(today.year, today.month, today.day, 1);
      break;

    case "yesterday":
      startLocal = addCalendarDays(
        today.year,
        today.month,
        today.day,
        -1,
      );
      endLocal = today;
      break;

    case "7d": {
      startLocal = addCalendarDays(
        today.year,
        today.month,
        today.day,
        -6,
      );
      endLocal = addCalendarDays(
        today.year,
        today.month,
        today.day,
        1,
      );
      break;
    }

    case "30d": {
      startLocal = addCalendarDays(
        today.year,
        today.month,
        today.day,
        -29,
      );
      endLocal = addCalendarDays(
        today.year,
        today.month,
        today.day,
        1,
      );
      break;
    }

    default:
      throw new AnalyticsError(
        "INVALID_DATE_RANGE",
        `Unsupported range: ${range}.`,
      );
  }

  const start = new Date(
    localMidnightUtc(
      startLocal.year,
      startLocal.month,
      startLocal.day,
      timeZone,
    ),
  );
  const end = new Date(
    localMidnightUtc(
      endLocal.year,
      endLocal.month,
      endLocal.day,
      timeZone,
    ),
  );

  return { start, end };
}

/**
 * 解析 custom 范围的单个日期边界。
 *
 * 仅日期（YYYY-MM-DD）按指定时区的本地午夜解析；
 * 带时刻的 ISO 字符串直接解析为瞬时。
 */
function parseRangeDate(
  value: string,
  timeZone: string,
  field: "start" | "end",
): Date {
  if (!value) {
    throw new AnalyticsError(
      "INVALID_DATE_RANGE",
      `Invalid ${field} date: ${value}.`,
    );
  }

  if (DATE_ONLY_REGEX.test(value)) {
    const [year, month, day] = value.split("-").map(Number);

    if (!isValidCalendarDate(year, month, day)) {
      throw new AnalyticsError(
        "INVALID_DATE_RANGE",
        `Invalid ${field} calendar date: ${value}.`,
      );
    }

    return new Date(
      localMidnightUtc(year, month, day, timeZone),
    );
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new AnalyticsError(
      "INVALID_DATE_RANGE",
      `Invalid ${field} date: ${value}.`,
    );
  }

  return parsed;
}

/**
 * 解析并校验统计分析查询的日期范围。
 *
 * 时间范围统一采用 [start, end)，start 必须早于 end。
 */
export function parseDateRange(
  input: {
    range?: string;
    start?: string;
    end?: string;
    timeZone?: string;
  },
  options: { defaultTimeZone?: string } = {},
): DateRangeResult {
  const defaultTimeZone = options.defaultTimeZone ?? DEFAULT_TIME_ZONE;

  const rangeRaw = input.range ?? DEFAULT_RANGE;
  if (!VALID_RANGES.includes(rangeRaw as AnalyticsRange)) {
    throw new AnalyticsError(
      "INVALID_DATE_RANGE",
      `Invalid range: ${rangeRaw}.`,
    );
  }
  const range = rangeRaw as AnalyticsRange;

  const timeZone = input.timeZone ?? defaultTimeZone;
  if (!isValidTimeZone(timeZone)) {
    throw new AnalyticsError(
      "INVALID_TIMEZONE",
      `Invalid IANA timezone: ${timeZone}.`,
    );
  }

  let start: Date;
  let end: Date;

  if (range === "custom") {
    if (!input.start || !input.end) {
      throw new AnalyticsError(
        "INVALID_DATE_RANGE",
        "custom range requires both start and end.",
      );
    }

    start = parseRangeDate(input.start, timeZone, "start");
    end = parseRangeDate(input.end, timeZone, "end");
  } else {
    const bounds = computePresetRange(range, timeZone);
    start = bounds.start;
    end = bounds.end;
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AnalyticsError(
      "INVALID_DATE_RANGE",
      "start and end must be valid dates.",
    );
  }

  if (start.getTime() >= end.getTime()) {
    throw new AnalyticsError(
      "INVALID_DATE_RANGE",
      "start must be earlier than end.",
    );
  }

  return {
    range,
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    timeZone,
  };
}
