import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "../hooks/useStore";

// A sale's save can reach the server twice (a connection that drops before the reply makes the phone send it again).
// The second copy is refused by the unique client_txn_id — which means the sale IS saved. The app must carry on with
// the saved row, not show "Save failed — duplicate key value…", drop the sale from the list and email the owner that
// the transaction failed.

// Plain functions, not jest.fn(): CRA resets jest.fn implementations between tests.
let mockInsertReply = () => ({ data: null, error: null });
let mockSaved = () => null;
const mockLookups = [];
const mockEmails = [];

jest.mock("../utils/supabase", () => {
  const query = () => {
    const q = { op: "select", eq: {} };
    const settle = () => ({ data: [], error: null });
    const self = new Proxy({}, {
      get(_t, k) {
        if (k === "then") return (res, rej) => Promise.resolve(settle()).then(res, rej);
        if (k === "insert") return (row) => { q.op = "insert"; q.row = row; return self; };
        if (k === "eq") return (col, val) => { q.eq[col] = val; return self; };
        if (k === "single") return () => Promise.resolve(q.op === "insert" ? mockInsertReply(q.row) : { data: null, error: null });
        if (k === "maybeSingle") return () => {
          if (q.eq.client_txn_id) { mockLookups.push(q.eq.client_txn_id); return Promise.resolve({ data: mockSaved(q.eq.client_txn_id), error: null }); }
          return Promise.resolve({ data: null, error: null });
        };
        return () => self;
      },
    });
    return self;
  };
  const channel = () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} }; return c; };
  return {
    supabase: {
      from: query, rpc: () => Promise.resolve({ data: null, error: null }), channel, removeChannel: () => {},
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      auth: {
        getUser: () => Promise.resolve({ data: { user: null } }),
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
jest.mock("../utils/emailTrigger", () => ({ sendEmailTrigger: (...a) => { mockEmails.push(a[0]); return Promise.resolve(); } }));
jest.mock("../lib/notifyEngine", () => ({ notify: () => Promise.resolve(), notifyBranchManager: () => Promise.resolve() }));
jest.mock("../utils/auditLog", () => ({ logAudit: () => Promise.resolve() }));
jest.mock("../utils/offlineDb", () => ({ savePendingOp: () => Promise.resolve(), getPendingCount: () => Promise.resolve(0), getPendingOps: () => Promise.resolve([]) }));
jest.mock("@capacitor/app", () => ({ App: { addListener: () => Promise.resolve({ remove() {} }) } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root, api;
function Harness() { api = useStore(null); return null; }
beforeEach(async () => {
  mockLookups.length = 0; mockEmails.length = 0;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const add = async () => { let res; await act(async () => { res = await api.addTransaction({ type: "in", amount: 500, item_name: "Rice" }); }); return res; };
const DUP_TXN = { code: "23505", message: 'duplicate key value violates unique constraint "transactions_client_txn_id_key"' };

describe("saving a transaction the server already has", () => {
  it("carries on with the saved row: no error, kept in the list, no 'failed' email", async () => {
    let sentId = null;
    mockInsertReply = (row) => { sentId = row.client_txn_id; return { data: null, error: DUP_TXN }; };
    mockSaved = (id) => ({ id: "row-1", client_txn_id: id, type: "in", amount: 500, item_name: "Rice" });
    const res = await add();
    expect(mockLookups).toEqual([sentId]);                 // looked up by this sale's own key
    expect(res?.id).toBe("row-1");
    expect(api.dbError).toBeNull();
    expect(api.transactions.map((t) => t.id)).toEqual(["row-1"]);
    expect(mockEmails).not.toContain("transaction_failed");
  });

  it("a real failure still shows the error, drops the row and emails the owner", async () => {
    mockInsertReply = () => ({ data: null, error: { code: "23502", message: 'null value in column "amount"' } });
    const res = await add();
    expect(res).toBeUndefined();
    expect(api.dbError).toMatch(/null value/);
    expect(api.transactions).toEqual([]);
    expect(mockEmails).toContain("transaction_failed");
    expect(mockLookups).toEqual([]);
  });

  it("a duplicate on any OTHER key is still an error", async () => {
    mockInsertReply = () => ({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "transactions_pkey"' } });
    await add();
    expect(api.dbError).toMatch(/transactions_pkey/);
    expect(mockLookups).toEqual([]);
  });
});
