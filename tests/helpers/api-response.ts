
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: Record<string, unknown>;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export async function readApiError(
  response: Response,
): Promise<ApiErrorResponse> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== false ||
    !isRecord(body.error) ||
    typeof body.error.code !== "string" ||
    typeof body.error.message !== "string"
  ) {
    throw new Error("Invalid API error response.");
  }

  return {
    success: false,
    error: {
      code: body.error.code,
      message: body.error.message,
    },
  };
}

export async function readApiSuccess<T>(
  response: Response,
  isData: (value: unknown) => value is T,
): Promise<ApiSuccessResponse<T>> {
  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    body.success !== true ||
    !isRecord(body.meta) ||
    !isData(body.data)
  ) {
    throw new Error("Invalid API success response.");
  }

  return {
    success: true,
    data: body.data,
    meta: body.meta,
  };
}
