// Launch reliability + offline (2026-10-14): queued sales stay visible, weak-signal failures are recognised, a failed
// section load retries and reloads at most once, every request has a time limit, the saved session is found.

import { getPendingOps } from "../utils/offlineDb";
import { pendingRows, withPending, isNetworkFailure } from "../hooks/useStore";
import { isChunkLoadError, reloadOnceForNewVersion, importWithRetry } from "../utils/lazyWithRetry";
import { readStoredSession } from "../hooks/useAuth";

jest.mock("../utils/offlineDb", () => ({
  getPendingOps: jest.fn(),
  savePendingOp: jest.fn(),
  getPendingCount: jest.fn(),
}));

describe("queued sales stay in the list", () => {
  it("turns queued ops into pending rows by table", async () => {
    getPendingOps.mockResolvedValue([
      { local_id: "a1", table: "transactions", data: { client_txn_id: "a1", amount: 500 } },
      { local_id: "c1", table: "credits", data: { customer_name: "Ada", amount: 500 } },
      { local_id: "x1", table: "products", data: {} },
    ]);
    const p = await pendingRows("u1");
    expect(p.transactions).toEqual([{ client_txn_id: "a1", amount: 500, id: "tmp-a1", _pending: true }]);
    expect(p.credits).toHaveLength(1);
    expect(p.credits[0]).toMatchObject({ id: "tmp-c1", _pending: true });
  });

  it("an unreadable queue never breaks loading", async () => {
    getPendingOps.mockRejectedValue(new Error("idb blocked"));
    expect(await pendingRows("u1")).toEqual({ transactions: [], credits: [] });
  });

  it("adds queued rows on top, without duplicating ones the server already has", () => {
    const server = [{ id: "s1", client_txn_id: "a1" }, { id: "s2", client_txn_id: "b2" }];
    const pending = [{ id: "tmp-a1", client_txn_id: "a1", _pending: true }, { id: "tmp-c3", client_txn_id: "c3", _pending: true }];
    const out = withPending(server, pending);
    expect(out.map((r) => r.id)).toEqual(["tmp-c3", "s1", "s2"]);
    expect(withPending(out, pending)).toBe(out);           // already merged → unchanged
    expect(withPending(server, [])).toBe(server);
  });
});

describe("weak signal is a network failure", () => {
  it.each([
    "TypeError: Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.",
    "AbortError: The user aborted a request.", "Request timed out",
  ])("%s", (m) => expect(isNetworkFailure({ message: m })).toBe(true));
  it("a real refusal is not", () => {
    expect(isNetworkFailure({ message: 'duplicate key value violates unique constraint "x"', code: "23505" })).toBe(false);
    expect(isNetworkFailure({ message: "new row violates row-level security policy" })).toBe(false);
  });
});

describe("loading a section of the app", () => {
  const realLocation = window.location;
  let reload;
  beforeEach(() => {
    reload = jest.fn();
    delete window.location;
    window.location = { ...realLocation, reload };
    sessionStorage.clear();
  });
  afterEach(() => { window.location = realLocation; });

  it("recognises a failed download of an old version's file", () => {
    expect(isChunkLoadError({ name: "ChunkLoadError", message: "Loading chunk 123 failed." })).toBe(true);
    expect(isChunkLoadError({ message: "Failed to fetch dynamically imported module: /static/js/x.js" })).toBe(true);
    expect(isChunkLoadError({ message: "Cannot read properties of undefined" })).toBe(false);
  });

  it("reloads at most once a minute (a real outage can't loop)", () => {
    expect(reloadOnceForNewVersion()).toBe(true);
    expect(reloadOnceForNewVersion()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("retries a failed import once before giving up", async () => {
    const mod = { default: () => null };
    const factory = jest.fn().mockRejectedValueOnce(new Error("Loading chunk 9 failed.")).mockResolvedValueOnce(mod);
    await expect(importWithRetry(factory, 1)).resolves.toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("two failures of an old version reload the page once", async () => {
    const factory = jest.fn().mockRejectedValue(new Error("Loading chunk 9 failed."));
    const p = importWithRetry(factory, 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(2);
    void p;
  });

  it("a real bug (not a download problem) is not hidden by a reload", async () => {
    const factory = jest.fn().mockRejectedValue(new Error("x is not a function"));
    await expect(importWithRetry(factory, 1)).rejects.toThrow("x is not a function");
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("saved session on the device", () => {
  beforeEach(() => localStorage.clear());
  it("finds Supabase's stored session (offline start)", () => {
    localStorage.setItem("sb-kudiai-auth-token", JSON.stringify({ access_token: "a", refresh_token: "r", user: { id: "u1" } }));
    expect(readStoredSession()?.user.id).toBe("u1");
  });
  it("nothing stored → null (a real sign-out goes to the login screen)", () => {
    localStorage.setItem("kuditrack_plan", "pro");
    expect(readStoredSession()).toBeNull();
  });
});

describe("every request has a time limit", () => {
  it("aborts a request that never answers", async () => {
    jest.useFakeTimers();
    const realFetch = global.fetch;
    global.fetch = jest.fn((_u, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("The user aborted a request."), { name: "AbortError" })));
    }));
    const { fetchWithTimeout } = jest.requireActual("../utils/supabase");
    const p = fetchWithTimeout("https://kudiai.app/sb/rest/v1/profiles?id=eq.1", {});
    jest.advanceTimersByTime(20001);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    global.fetch = realFetch;
    jest.useRealTimers();
  });
});
