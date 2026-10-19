import { buildEsusuPayoutReceipt } from "../utils/receiptConfig";

const payout = {
  id: "3f2a9c1e-0000-4000-8000-000000000001", amount: 50000, status: "completed", created_at: "2026-10-19T10:15:00+01:00",
  receipt_ref: "KDT-202610-AB12CD34", balance_after: 61500, client_name: "Ngozi Eze", position: 3, winners_together: 1,
};

test("an esusu payout receipt names the member, group, turn, destination and the stored reference", () => {
  const r = buildEsusuPayoutReceipt(payout, { groupName: "Market Women Esusu", roundNumber: 2, businessName: "Amara Foods" });
  const f = Object.fromEntries(r.fields.map(x => [x.label, x.value]));
  expect(r.title).toBe("Esusu Payout");
  expect(r.direction).toBe("in");
  expect(r.status).toBe("success");
  expect(r.amount).toBe(50000);
  expect(f["Paid to"]).toBe("Ngozi Eze");
  expect(f["Esusu group"]).toBe("Market Women Esusu");
  expect(f["Turn"]).toBe("Round 2, Position 3");
  expect(f["Paid into"]).toBe("Savings balance");
  expect(f["Balance After"]).toBe("₦61,500.00");
  expect(f["Reference"]).toBe("KDT-202610-AB12CD34");
  expect(f["Shared turn"]).toBeUndefined();
  expect(r.businessName).toBe("Amara Foods");
});

test("a shared turn says how many members were paid together", () => {
  const r = buildEsusuPayoutReceipt({ ...payout, winners_together: 2 }, { groupName: "G", roundNumber: 1 });
  expect(r.fields.find(x => x.label === "Shared turn").value).toBe("2 members paid this turn");
});
