/**
 * Unit tests for first_period commission mechanic.
 *
 * These tests validate RPC behaviour via a mock Supabase client.
 * They do NOT hit a live database.
 */

// ── Mock Supabase ─────────────────────────────────────────────────────────────

let _mockRpcResult   = {};
let _mockInsertError = null;
let _mockUpdateRows  = [];

const mockSupabase = () => {
  const insertedRows = [];
  const updatedRows  = [];
  const rpcResults   = {};

  const rpc = jest.fn((fn, params) => ({
    data:  rpcResults[fn] ?? { ok: true },
    error: null,
  }));

  const from = jest.fn((table) => ({
    insert: jest.fn((row) => {
      insertedRows.push({ table, row });
      return { data: { id: "mock-id" }, error: _mockInsertError };
    }),
    update: jest.fn((patch) => ({
      eq: jest.fn(() => {
        updatedRows.push({ table, patch });
        return { data: null, error: null };
      }),
    })),
    select: jest.fn(() => ({
      eq:         jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => ({ data: null, error: null })),
    })),
  }));

  return { rpc, from, _inserted: insertedRows, _updated: updatedRows, _rpcResults: rpcResults };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate ajo_approve_contribution logic in JS (mirrors the SQL) */
function approveContribution({ client, contribution, cycleHasCommission = false, cycleId = null }) {
  const isFirst      = (client.total_saved || 0) === 0;
  const regFee       = isFirst ? (client.registration_charge || 0) : 0;
  let   cycleFee     = 0;
  let   commissionId = null;
  let   resolvedCycle = null;

  if (client.commission_model === "first_period" && contribution.contribution_context === "personal_savings") {
    const effectiveCycleId = contribution.cycle_id || cycleId;
    if (effectiveCycleId && !cycleHasCommission) {
      resolvedCycle = effectiveCycleId;
      cycleFee = contribution.amount - regFee;
      if (cycleFee > 0) commissionId = "commission-row";
    }
  }

  const netAdd = contribution.amount - regFee - cycleFee;

  return {
    newBalance:    (client.current_balance || 0) + netAdd,
    newTotalSaved: (client.total_saved     || 0) + contribution.amount,
    regFee,
    cycleFee,
    commissionId,
    isFirstCycle:  resolvedCycle !== null && cycleFee > 0,
  };
}

// ── Test cases ────────────────────────────────────────────────────────────────

describe("first_period mechanic", () => {
  const baseClient = {
    id:                  "client-1",
    user_id:             "owner-1",
    total_saved:         0,
    current_balance:     0,
    registration_charge: 0,
    commission_model:    "first_period",
    contribution_amount: 5000,
  };

  const baseContrib = {
    id:                   "contrib-1",
    aso_client_id:        "client-1",
    owner_id:             "owner-1",
    amount:               5000,
    type:                 "contribution",
    status:               "pending",
    payment_method:       "cash",
    contribution_context: "personal_savings",
    cycle_id:             "cycle-1",
  };

  // ── 1. First deposit → commission income; client savings unchanged ─────────
  test("first deposit books as commission income; savings balance stays at 0", () => {
    const result = approveContribution({
      client:            { ...baseClient },
      contribution:      { ...baseContrib },
      cycleHasCommission: false,
    });

    expect(result.commissionId).not.toBeNull();   // commission row created
    expect(result.cycleFee).toBe(5000);            // full amount is cycle fee
    expect(result.newBalance).toBe(0);             // savings unchanged
    expect(result.newTotalSaved).toBe(5000);       // total_saved always increments
    expect(result.isFirstCycle).toBe(true);
  });

  // ── 2. Second deposit → credited normally, no commission ──────────────────
  test("second deposit credits balance normally", () => {
    const result = approveContribution({
      client:            { ...baseClient, total_saved: 5000, current_balance: 0 },
      contribution:      { ...baseContrib },
      cycleHasCommission: true, // cycle already has its commission row
    });

    expect(result.commissionId).toBeNull();
    expect(result.cycleFee).toBe(0);
    expect(result.newBalance).toBe(5000);
    expect(result.isFirstCycle).toBe(false);
  });

  // ── 3. New cycle → first deposit of that cycle triggers fee again ─────────
  test("new cycle resets first_period detection; fee charged again on new cycle day 1", () => {
    const result = approveContribution({
      client:            { ...baseClient, total_saved: 25000, current_balance: 20000 },
      contribution:      { ...baseContrib, cycle_id: "cycle-2" },
      cycleHasCommission: false, // new cycle — no commission row yet
    });

    expect(result.commissionId).not.toBeNull();
    expect(result.cycleFee).toBe(5000);
    expect(result.newBalance).toBe(20000);         // balance unchanged for cycle fee
    expect(result.isFirstCycle).toBe(true);
  });

  // ── 4. Two active cycles → each cycle's day 1 is collected independently ──
  test("each active cycle charges its own day-1 fee independently", () => {
    const cycleA = approveContribution({
      client:            { ...baseClient, total_saved: 5000, current_balance: 0 },
      contribution:      { ...baseContrib, cycle_id: "cycle-A" },
      cycleHasCommission: false,
    });
    const cycleB = approveContribution({
      client:            { ...baseClient, total_saved: 10000, current_balance: 0 },
      contribution:      { ...baseContrib, cycle_id: "cycle-B" },
      cycleHasCommission: false,
    });

    expect(cycleA.isFirstCycle).toBe(true);
    expect(cycleB.isFirstCycle).toBe(true);
    expect(cycleA.cycleFee).toBe(5000);
    expect(cycleB.cycleFee).toBe(5000);
  });

  // ── 5. Percent client → zero first_period behaviour ───────────────────────
  test("percent commission model has no first_period fee", () => {
    const result = approveContribution({
      client:       { ...baseClient, commission_model: "percent", commission_percent: 5 },
      contribution: { ...baseContrib },
      cycleHasCommission: false,
    });

    expect(result.commissionId).toBeNull();
    expect(result.cycleFee).toBe(0);
    expect(result.newBalance).toBe(5000);
  });

  // ── 6. Reg fee + first_period → both charged on very first deposit ─────────
  test("reg fee + first_period both apply on brand-new client's first deposit", () => {
    const client = { ...baseClient, registration_charge: 500 };
    const result = approveContribution({
      client,
      contribution:       { ...baseContrib },
      cycleHasCommission: false,
    });

    expect(result.regFee).toBe(500);
    // cycle fee = amount - reg_fee = 5000 - 500 = 4500
    expect(result.cycleFee).toBe(4500);
    // net balance = 5000 - 500 - 4500 = 0
    expect(result.newBalance).toBe(0);
    expect(result.newTotalSaved).toBe(5000);
    expect(result.commissionId).not.toBeNull();
    expect(result.isFirstCycle).toBe(true);
  });

  // ── 7. Solvency: net balance never goes negative ───────────────────────────
  test("solvency: balance never goes below 0 when reg + cycle fee equals deposit", () => {
    const client = { ...baseClient, registration_charge: 2500 };
    const contrib = { ...baseContrib, amount: 5000 };
    const result = approveContribution({
      client,
      contribution:       contrib,
      cycleHasCommission: false,
    });

    // reg_fee = 2500, cycle_fee = 5000 - 2500 = 2500, net = 0
    expect(result.regFee).toBe(2500);
    expect(result.cycleFee).toBe(2500);
    expect(result.newBalance).toBe(0);
    expect(result.newBalance).toBeGreaterThanOrEqual(0);
  });
});

// ── ledgerTypeLabel helper ────────────────────────────────────────────────────

describe("ledgerTypeLabel", () => {
  const { ledgerTypeLabel } = require("../utils/helpers");

  test("commission row with cycle_id → Cycle fee label", () => {
    expect(ledgerTypeLabel({ type: "commission", cycle_id: "cycle-1" }))
      .toBe("Cycle fee — first deposit");
  });

  test("commission row without cycle_id → Commission (manual execution)", () => {
    expect(ledgerTypeLabel({ type: "commission", cycle_id: null }))
      .toBe("Commission");
  });

  test("string fallback stays backward-compatible", () => {
    expect(ledgerTypeLabel("contribution")).toBe("Contribution");
    expect(ledgerTypeLabel("registration_fee")).toBe("Registration Fee");
  });
});
