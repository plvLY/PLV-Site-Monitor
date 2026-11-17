import { AnalyticsError } from "./errors";

export interface QueryFieldRule {
  required?: boolean;
}

export interface ParsedQuery {
  [key: string]: string | string[] | undefined;
}

/**
 * 通用查询参数校验器。
 *
 * 解析 URLSearchParams，拒绝重复的关键参数以避免参数歧义，
 * 支持 required 与可选参数，非法参数统一返回 INVALID_QUERY。
 */
export class QueryValidator {
  private readonly params: URLSearchParams;
  private readonly strict: boolean;

  constructor(
    searchParams: URLSearchParams | string | Record<string, string>,
    options: { strict?: boolean } = {},
  ) {
    if (searchParams instanceof URLSearchParams) {
      this.params = searchParams;
    } else if (typeof searchParams === "string") {
      this.params = new URLSearchParams(searchParams);
    } else {
      this.params = new URLSearchParams(searchParams);
    }

    this.strict = options.strict ?? true;
  }

  /**
   * 解析并返回所有参数。在 strict 模式下，重复的关键参数会抛出 INVALID_QUERY。
   */
  parse(): ParsedQuery {
    const result: ParsedQuery = {};
    const seen = new Set<string>();

    for (const [key, value] of this.params.entries()) {
      if (seen.has(key)) {
        if (this.strict) {
          throw new AnalyticsError(
            "INVALID_QUERY",
            `Duplicate query parameter: ${key}.`,
          );
        }

        // 非 strict 模式保留全部值。
        if (!result[key]) {
          result[key] = value;
        } else if (Array.isArray(result[key])) {
          (result[key] as string[]).push(value);
        } else {
          result[key] = [result[key] as string, value];
        }

        continue;
      }

      seen.add(key);
      result[key] = value;
    }

    return result;
  }

  /**
   * 读取单个参数值。若参数缺失且 required，抛出 INVALID_QUERY。
   * 重复的关键参数会被拒绝，避免参数歧义。
   */
  getString(
    key: string,
    rule: QueryFieldRule = {},
  ): string | null {
    if (this.params.getAll(key).length > 1) {
      throw new AnalyticsError(
        "INVALID_QUERY",
        `Duplicate query parameter: ${key}.`,
      );
    }

    const value = this.params.get(key);

    if (value === null) {
      if (rule.required) {
        throw new AnalyticsError(
          "INVALID_QUERY",
          `Missing required query parameter: ${key}.`,
        );
      }

      return null;
    }

    return value;
  }

  /**
   * 读取单个参数值并校验是否在允许的枚举值中。
   */
  getEnum<T extends string>(
    key: string,
    allowed: T[],
    rule: QueryFieldRule = {},
  ): T | null {
    const value = this.getString(key, rule);

    if (value === null) {
      return null;
    }

    if (!allowed.includes(value as T)) {
      throw new AnalyticsError(
        "INVALID_QUERY",
        `Invalid value for query parameter: ${key}.`,
      );
    }

    return value as T;
  }

  /**
   * 读取单个参数并解析为正整数。
   */
  getPositiveInt(
    key: string,
    rule: QueryFieldRule = {},
  ): number | null {
    const value = this.getString(key, rule);

    if (value === null) {
      return null;
    }

    const parsed = Number.parseInt(value, 10);

    if (
      !Number.isFinite(parsed) ||
      parsed <= 0 ||
      String(parsed) !== value
    ) {
      throw new AnalyticsError(
        "INVALID_QUERY",
        `Invalid positive integer for query parameter: ${key}.`,
      );
    }

    return parsed;
  }

  /**
   * 读取单个参数并解析为范围内的整数。
   */
  getIntInRange(
    key: string,
    { min, max, rule }: { min: number; max: number; rule?: QueryFieldRule },
  ): number | null {
    const value = this.getString(key, rule);

    if (value === null) {
      return null;
    }

    const parsed = Number.parseInt(value, 10);

    if (
      !Number.isFinite(parsed) ||
      parsed < min ||
      parsed > max ||
      String(parsed) !== value
    ) {
      throw new AnalyticsError(
        "INVALID_QUERY",
        `Invalid integer for query parameter: ${key}.`,
      );
    }

    return parsed;
  }

  /**
   * 检查参数是否存在。
   */
  has(key: string): boolean {
    return this.params.has(key);
  }

  /**
   * 返回某参数的全部值（用于检测重复）。
   */
  getAll(key: string): string[] {
    return this.params.getAll(key);
  }
}
