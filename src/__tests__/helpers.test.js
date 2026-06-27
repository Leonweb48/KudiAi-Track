import { fmt, today, filterByPeriod } from "../utils/helpers";

describe("fmt", () => {
  it("formats whole number with naira symbol, commas and 2 decimals", () => {
    expect(fmt(1000)).toBe("₦1,000.00");
  });
  it("formats decimal correctly", () => {
    expect(fmt(1500.5)).toBe("₦1,500.50");
  });
  it("formats zero", () => {
    expect(fmt(0)).toBe("₦0.00");
  });
  it("treats null as 0", () => {
    expect(fmt(null)).toBe("₦0.00");
  });
  it("treats undefined as 0", () => {
    expect(fmt(undefined)).toBe("₦0.00");
  });
  it("formats large amounts with commas", () => {
    expect(fmt(1000000)).toBe("₦1,000,000.00");
  });
  it("handles string numbers", () => {
    expect(fmt("500")).toBe("₦500.00");
  });
});

describe("today", () => {
  it("returns a string in YYYY-MM-DD format", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("matches the current date", () => {
    expect(today()).toBe(new Date().toISOString().split("T")[0]);
  });
});

describe("filterByPeriod", () => {
  const todayStr = new Date().toISOString().split("T")[0];

  const txns = [
    { transaction_date: todayStr,   amount: 100 },
    { transaction_date: "2020-01-01", amount: 200 }, // clearly old
  ];

  it("'today' returns only today's transactions", () => {
    const result = filterByPeriod(txns, "today");
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(100);
  });

  it("'month' excludes transactions older than 30 days", () => {
    const result = filterByPeriod(txns, "month");
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(100);
  });

  it("'week' excludes transactions older than 7 days", () => {
    const result = filterByPeriod(txns, "week");
    expect(result).toHaveLength(1);
  });

  it("returns all matching records when multiple qualify", () => {
    const multiple = [
      { transaction_date: todayStr, amount: 50 },
      { transaction_date: todayStr, amount: 75 },
    ];
    expect(filterByPeriod(multiple, "today")).toHaveLength(2);
  });

  it("returns empty array when no transactions match", () => {
    expect(filterByPeriod([{ transaction_date: "2020-01-01", amount: 10 }], "today")).toHaveLength(0);
  });
});
