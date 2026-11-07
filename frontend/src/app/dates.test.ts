import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./dates";

// Local times, so the results do not depend on the machine's time zone.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe("dates read day, month, year", () => {
  it.each([
    [at(2026, 10, 27), "27 Oct 2026"],
    [at(2025, 9, 4), "04 Sep 2025"],
    [at(2024, 1, 1), "01 Jan 2024"],
    [at(2023, 12, 31), "31 Dec 2023"],
  ])("%s → %s", (date, text) => {
    expect(formatDate(date)).toBe(text);
  });

  it("with the time, 12-hour", () => {
    expect(formatDateTime(at(2026, 10, 27, 10, 5))).toBe("27 Oct 2026, 10:05 AM");
    expect(formatDateTime(at(2026, 10, 27, 0, 30))).toBe("27 Oct 2026, 12:30 AM");
    expect(formatDateTime(at(2026, 10, 27, 12, 0))).toBe("27 Oct 2026, 12:00 PM");
    expect(formatDateTime(at(2026, 10, 27, 23, 59))).toBe("27 Oct 2026, 11:59 PM");
  });

  it("accepts the server's ISO strings", () => {
    const iso = at(2025, 9, 4, 14, 2).toISOString();
    expect(formatDateTime(iso)).toBe("04 Sep 2025, 2:02 PM");
  });
});
