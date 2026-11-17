
import { describe, expect, it } from "vitest";

describe("Vitest environment", () => {
  it("should execute TypeScript tests", () => {
    const result = 1 + 1;

    expect(result).toBe(2);
  });
});
