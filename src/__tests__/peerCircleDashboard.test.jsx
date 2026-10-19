import { TextEncoder, TextDecoder } from "util";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

// The circle screen's imports (wallet UI) need these; jsdom doesn't provide them. Load the screen after setting them.
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const { PeerCircleDashboard } = require("../screens/PeerEsusuScreen");
const { supabase } = require("../utils/supabase");

jest.mock("../utils/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock("../hooks/usePlatformConfig", () => ({ usePlatformConfig: () => ({ walletMoveFeeKobo: 1000 }) }));

// A client-started circle must show the same dashboard as a business-run esusu group.
const detail = {
  group: { id: "g1", name: "Market Women Circle", status: "active", contribution_amount: 5000, frequency: "weekly",
    payout_slots_per_round: 1, creator_user_id: "u1" },
  members: [
    { id: "m1", user_id: "u1", display_name: "Ada Obi", status: "active" },
    { id: "m2", user_id: "u2", display_name: "Bisi Lawal", status: "active" },
    { id: "m3", user_id: "u3", display_name: "Chi Eze", status: "active" },
  ],
  round: { id: "r1", round_number: 1, status: "active" },
  turns: [
    { id: "t1", user_id: "u1", position: 1, status: "current" },
    { id: "t2", user_id: "u2", position: 2, status: "upcoming" },
    { id: "t3", user_id: "u3", position: 3, status: "upcoming" },
  ],
  contributions: [{ user_id: "u1", amount: 5000 }, { user_id: "u2", amount: 5000 }],
  is_creator: false,
};

let host, root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function show(data, myUserId) {
  supabase.functions.invoke.mockResolvedValue({ data, error: null });
  await act(async () => { root.render(<PeerCircleDashboard groupId="g1" myUserId={myUserId} />); });
  await act(async () => { await Promise.resolve(); });
  return host.textContent;
}

test("an active circle renders the esusu dashboard: pot, ticks, rotation order, your-turn banner", async () => {
  const text = await show(detail, "u2");
  expect(text).toContain("Current Pot");
  expect(text).toMatch(/10,000/);                    // pot = what was paid this cycle
  expect(text).toContain("Round 1");
  expect(text).toContain("Rotation Order");
  expect(text).toContain("Your turn is next");       // u2 is next after u1
  expect(text).toContain("(You)");
  expect(text).toContain("paid for this payout");    // u2 has paid
  expect(text).not.toContain("Pay Out");             // only the creator pays out
});

test("the creator gets Pay Out; a member who hasn't paid gets Pay my contribution", async () => {
  const text = await show({ ...detail, is_creator: true }, "u3");
  expect(text).toContain("Pay Out");
  expect(text).toMatch(/Pay my .*5,000.* contribution/);
});

test("Pay Out asks for the PIN and sends it with the payout (the server checks it again)", async () => {
  const allPaid = { ...detail, is_creator: true,
    contributions: [{ user_id: "u1", amount: 5000 }, { user_id: "u2", amount: 5000 }, { user_id: "u3", amount: 5000 }] };
  const calls = [];
  supabase.functions.invoke.mockImplementation(async (fn, { body }) => {
    calls.push({ fn, ...body });
    if (fn === "pin-manager") return { data: { success: true }, error: null };
    if (body.action === "execute-payout") return { data: { ok: true, winners: [{ user_id: "u1", amount: 15000 }], per_winner_amount: 15000, pot_amount: 15000 }, error: null };
    return { data: allPaid, error: null };
  });
  await act(async () => { root.render(<PeerCircleDashboard groupId="g1" myUserId="u1" />); });
  await act(async () => { await Promise.resolve(); });
  const button = (label) => [...host.ownerDocument.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  await act(async () => { button("Pay Out").click(); });
  for (const d of "2468") await act(async () => { button(d).click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });   // the PIN pad checks 150 ms after the 4th digit
  const payout = calls.find((c) => c.action === "execute-payout");
  expect(payout).toMatchObject({ group_id: "g1", pin: "2468" });
  expect(host.ownerDocument.body.textContent).toContain("Payout Completed");
});

test("Pay my contribution asks for the PIN and sends it (the server checks it again)", async () => {
  const calls = [];
  supabase.functions.invoke.mockImplementation(async (fn, { body }) => {
    calls.push({ fn, ...body });
    if (fn === "pin-manager") return { data: { success: true }, error: null };
    if (body.action === "pay-contribution") return { data: { ok: true }, error: null };
    return { data: detail, error: null };
  });
  await act(async () => { root.render(<PeerCircleDashboard groupId="g1" myUserId="u3" />); });
  await act(async () => { await Promise.resolve(); });
  const button = (match) => [...host.ownerDocument.querySelectorAll("button")].find((b) => match.test(b.textContent.trim()));
  await act(async () => { button(/^Pay my .* contribution$/).click(); });
  expect(calls.some((c) => c.action === "pay-contribution")).toBe(false);   // nothing is paid before the PIN
  for (const d of "2468") await act(async () => { button(new RegExp(`^${d}$`)).click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });   // the PIN pad checks 150 ms after the 4th digit
  expect(calls.find((c) => c.action === "pay-contribution")).toMatchObject({ group_id: "g1", amount: 5000, pin: "2468" });
});
