import { creditFromSale, isoDueDate } from "../utils/creditFromSale";

describe("creditFromSale — a credit sale also records what the customer owes", () => {
  const base = { type: "in", category: "credit sale", amount: 13000, customer_name: "Mama Ngozi", item_name: "Semovita (10kg)", quantity: 1, cost_price: 11200, due_date: "2026-10-17" };

  test("single-item credit sale → credit for the full amount, with due date and item", () => {
    expect(creditFromSale(base, { receipt_ref: "KDT-202610-ABCD2345" })).toEqual({
      customer_name: "Mama Ngozi",
      total_amount:  13000,
      due_date:      "2026-10-17",
      notes:         "Credit sale: Semovita (10kg) (KDT-202610-ABCD2345)",
      items:         [{ product_name: "Semovita (10kg)", quantity: 1, unit_price: 13000, cost_price: 11200 }],
    });
  });

  test("multi-item credit sale keeps every line", () => {
    const t = { ...base, amount: 190500, item_name: null, quantity: null, line_items: [
      { name: "Rice (50kg bag)", qty: 2, unitPrice: 78000, costPrice: 70000 },
      { name: "Groundnut oil", qty: 3, unitPrice: 11500, enteredCostPrice: 9800 },
    ] };
    const c = creditFromSale(t);
    expect(c.total_amount).toBe(190500);
    expect(c.notes).toBe("Credit sale: 2 × Rice (50kg bag), 3 × Groundnut oil");
    expect(c.items).toEqual([
      { product_name: "Rice (50kg bag)", quantity: 2, unit_price: 78000, cost_price: 70000 },
      { product_name: "Groundnut oil", quantity: 3, unit_price: 11500, cost_price: 9800 },
    ]);
  });

  test("not a credit sale, no customer, or nothing owed → no credit", () => {
    expect(creditFromSale({ ...base, category: "sale" })).toBeNull();
    expect(creditFromSale({ ...base, type: "out" })).toBeNull();
    expect(creditFromSale({ ...base, customer_name: "  " })).toBeNull();
    expect(creditFromSale({ ...base, amount: 0 })).toBeNull();
    expect(creditFromSale(null)).toBeNull();
  });

  test("no due date chosen → open-ended credit", () => {
    expect(creditFromSale({ ...base, due_date: undefined }).due_date).toBeNull();
  });
});

describe("isoDueDate", () => {
  const now = new Date(2026, 9, 30, 15, 0);   // 30 Oct 2026, local time
  test("tomorrow and one week roll over the month end", () => {
    expect(isoDueDate("tomorrow", null, now)).toBe("2026-10-31");
    expect(isoDueDate("1week", null, now)).toBe("2026-11-06");
  });
  test("custom date passes through only when it is a real YYYY-MM-DD", () => {
    expect(isoDueDate("custom", "2026-12-24", now)).toBe("2026-12-24");
    expect(isoDueDate("custom", "", now)).toBeNull();
  });
  test("nothing chosen → null", () => {
    expect(isoDueDate(null, null, now)).toBeNull();
  });
});
