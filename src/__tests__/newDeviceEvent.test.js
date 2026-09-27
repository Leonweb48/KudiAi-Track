import { logPlatformSession } from "../hooks/useAuth";

// A minimal fake matching exactly the two chains logPlatformSession uses:
//   .from("platform_sessions").select(...).eq(...).order(...).limit(20)   -> { data: prevSessions }
//   .from("platform_sessions").insert({...})                             -> (result unused)
function fakeClient(prevSessions) {
  const insert = jest.fn(async () => ({ data: null, error: null }));
  const select = () => ({
    eq: () => ({ order: () => ({ limit: async () => ({ data: prevSessions, error: null }) }) }),
  });
  return { from: () => ({ select, insert }), _insert: insert };
}

const origFetch = global.fetch;
beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn(async () => { throw new Error("no network in tests"); });   // geo lookup is optional — must never block
});
afterEach(() => { global.fetch = origFetch; jest.restoreAllMocks(); });

describe("logPlatformSession — new-device window event", () => {
  it("fires kt:newDevice when this device/browser has never logged in before", async () => {
    const client = fakeClient([]);   // no prior sessions at all
    const seen = [];
    window.addEventListener("kt:newDevice", () => seen.push(1));
    await logPlatformSession(client, "u1", "business", "Amaka", "a@example.com");
    expect(seen.length).toBe(1);
    expect(client._insert).toHaveBeenCalledWith(expect.objectContaining({ is_new_device: true, user_id: "u1" }));
  });

  it("does NOT fire when this exact device_type + browser has been seen in the last 20 sessions", async () => {
    // jsdom's default UA has no Mobi/Android and no browser match in the real classifier -> device_type "desktop", browser "Other"
    const client = fakeClient([{ device_type: "desktop", browser: "Other", city: null }]);
    const seen = [];
    window.addEventListener("kt:newDevice", () => seen.push(1));
    await logPlatformSession(client, "u2", "business", "Amaka", "a@example.com");
    expect(seen.length).toBe(0);
    expect(client._insert).toHaveBeenCalledWith(expect.objectContaining({ is_new_device: false }));
  });

  it("never fires twice for the same tab/session (the existing per-tab dedupe still applies)", async () => {
    const client = fakeClient([]);
    let count = 0;
    window.addEventListener("kt:newDevice", () => count++);
    await logPlatformSession(client, "u3", "business", "Amaka", "a@example.com");
    await logPlatformSession(client, "u3", "business", "Amaka", "a@example.com");   // e.g. a token-refresh re-trigger
    expect(count).toBe(1);
    expect(client._insert).toHaveBeenCalledTimes(1);
  });

  it("the anomaly check failing on its own still defaults to 'new' (fails open, not silently skipped) and still records the session", async () => {
    // select() throws (the sub-query has its own try/catch and leaves isNewDevice at its true default);
    // insert() still works, so the row is still written and the event still fires.
    const insert = jest.fn(async () => ({ data: null, error: null }));
    const client = { from: () => ({ select: () => { throw new Error("boom"); }, insert }) };
    const seen = [];
    window.addEventListener("kt:newDevice", () => seen.push(1));
    await expect(logPlatformSession(client, "u4", "business", "Amaka", "a@example.com")).resolves.toBeUndefined();
    expect(seen.length).toBe(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ is_new_device: true }));
  });

  it("a total failure (the insert itself throws) never throws out to the caller and never fires the event", async () => {
    const client = { from: () => ({ select: () => { throw new Error("boom"); }, insert: () => { throw new Error("db down"); } }) };
    const seen = [];
    window.addEventListener("kt:newDevice", () => seen.push(1));
    await expect(logPlatformSession(client, "u5", "business", "Amaka", "a@example.com")).resolves.toBeUndefined();
    expect(seen.length).toBe(0);
  });
});
