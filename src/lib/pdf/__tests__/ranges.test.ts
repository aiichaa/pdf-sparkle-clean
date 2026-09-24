import { describe, it, expect } from "vitest";
import { parseRanges, formatRanges } from "../ranges";

describe("parseRanges", () => {
  it("parses pages, ranges and open-ended ranges", () => {
    expect(parseRanges("1-3, 5, 8-", 10)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
    expect(parseRanges("-2", 5)).toEqual([[0, 1]]);
    expect(parseRanges(" 2 ; 4 ", 5)).toEqual([[1], [3]]);
  });

  it("allows reversed ranges and en dashes", () => {
    expect(parseRanges("4-2", 5)).toEqual([[3, 2, 1]]);
    expect(parseRanges("1–2", 5)).toEqual([[0, 1]]);
  });

  it("rejects pages outside the document", () => {
    expect(() => parseRanges("0", 5)).toThrow(/doesn't exist/);
    expect(() => parseRanges("3-9", 5)).toThrow(/has 5 pages/);
  });

  it("rejects garbage and empty input", () => {
    expect(() => parseRanges("", 5)).toThrow(/at least one/);
    expect(() => parseRanges("abc", 5)).toThrow(/isn't a page/);
    expect(() => parseRanges("-", 5)).toThrow(/isn't a page/);
  });
});

describe("formatRanges", () => {
  it("compresses consecutive pages", () => {
    expect(formatRanges([0, 1, 2, 4, 7, 8, 9])).toBe("1-3, 5, 8-10");
    expect(formatRanges([3, 1, 1])).toBe("2, 4");
  });
});
