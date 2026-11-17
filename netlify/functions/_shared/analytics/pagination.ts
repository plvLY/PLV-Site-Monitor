
import { AnalyticsError } from "./errors";

export interface PaginationInput {
  page?: number;
  page_size?: number;
}

export interface PaginationResult {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  offset: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

/**
 * 统一分页计算。
 *
 * page 默认 1 且 >= 1；
 * page_size 默认 10，范围 1～100。
 * 非法值统一返回 INVALID_QUERY。
 */
export function parsePagination(
  input: PaginationInput,
): PaginationResult {
  const page =
    input.page === undefined
      ? DEFAULT_PAGE
      : input.page;

  const pageSize =
    input.page_size === undefined
      ? DEFAULT_PAGE_SIZE
      : input.page_size;

  if (
    !Number.isSafeInteger(page) ||
    page < 1
  ) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "page must be a safe integer greater than or equal to 1.",
    );
  }

  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < MIN_PAGE_SIZE ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      `page_size must be an integer between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}.`,
    );
  }

  const offset = (page - 1) * pageSize;

  if (!Number.isSafeInteger(offset)) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Pagination offset exceeds the safe integer range.",
    );
  }

  return {
    page,
    page_size: pageSize,
    total: 0,
    total_pages: 0,
    offset,
  };
}

/**
 * 用查询到的总条目数填充分页元信息。
 *
 * 无数据时 total 和 total_pages 均为 0。
 */
export function paginate(
  total: number,
  pagination: PaginationResult,
): PaginationResult {
  if (
    !Number.isSafeInteger(total) ||
    total < 0
  ) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "total must be a non-negative safe integer.",
    );
  }

  if (
    !Number.isSafeInteger(pagination.page) ||
    pagination.page < 1 ||
    !Number.isSafeInteger(pagination.page_size) ||
    pagination.page_size < MIN_PAGE_SIZE ||
    pagination.page_size > MAX_PAGE_SIZE ||
    !Number.isSafeInteger(pagination.offset) ||
    pagination.offset < 0
  ) {
    throw new AnalyticsError(
      "INVALID_QUERY",
      "Invalid pagination values.",
    );
  }

  const totalPages =
    total === 0
      ? 0
      : Math.ceil(total / pagination.page_size);

  return {
    ...pagination,
    total,
    total_pages: totalPages,
  };
}
