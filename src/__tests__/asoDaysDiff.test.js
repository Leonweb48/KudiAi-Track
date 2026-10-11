import { daysDiff } from "../utils/localDays";

// Ajo "Expected" counts and the overdue flag count whole LOCAL days between a date and today.
describe("Aso daysDiff", () => {
  const now = new Date(2026, 9, 11, 8, 30);   // 11 Oct 2026, 08:30 local

  test("the same day is 0 (was -1 in Nigeria: the date was read as UTC midnight)", () => {
    expect(daysDiff("2026-10-11", now)).toBe(0);
  });
  test("yesterday is 1, so a payment due yesterday is overdue today", () => {
    expect(daysDiff("2026-10-10", now)).toBe(1);
  });
  test("tomorrow is -1", () => {
    expect(daysDiff("2026-10-12", now)).toBe(-1);
  });
  test("full timestamps compare by calendar day", () => {
    expect(daysDiff(new Date(2026, 9, 4, 23, 59).toISOString(), now)).toBe(7);
  });
  test("no date → 0", () => {
    expect(daysDiff(null, now)).toBe(0);
  });
});
