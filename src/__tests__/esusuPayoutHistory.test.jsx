import { TextEncoder, TextDecoder } from "util";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const EsusuPayoutHistory = require("../components/EsusuPayoutHistory").default;
const { supabase } = require("../utils/supabase");

jest.mock("../utils/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock("../components/shared/TransactionDetailModal", () => () => null);

const history = {
  group: { id: "g1", name: "Market Women Esusu" },
  rounds: [{
    id: "r1", round_number: 2, status: "active", started_at: "2026-10-01T09:00:00Z", ended_at: null, total_paid: 50000,
    payouts: [{ id: "p1", amount: 50000, created_at: "2026-10-19T10:00:00Z", receipt_ref: "KDT-202610-AB12CD34",
      client_name: "Ngozi Eze", position: 1, winners_together: 1, status: "completed" }],
  }],
};

let host, root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); supabase.functions.invoke.mockReset(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });

test("loads the payout history once and keeps showing it (it used to refetch forever and stay blank)", async () => {
  supabase.functions.invoke.mockResolvedValue({ data: history, error: null });
  await act(async () => { root.render(<EsusuPayoutHistory groupId="g1" groupName="Market Women Esusu" businessName="Amara Foods" />); });
  await settle(); await settle();
  expect(host.textContent).toContain("Ngozi Eze");
  expect(host.textContent).toContain("KDT-202610-AB12CD34");
  expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
});

test("a group with no payouts says so", async () => {
  supabase.functions.invoke.mockResolvedValue({ data: { group: {}, rounds: [] }, error: null });
  await act(async () => { root.render(<EsusuPayoutHistory groupId="g2" groupName="G" />); });
  await settle();
  expect(host.textContent).toMatch(/No payouts yet/);
});
