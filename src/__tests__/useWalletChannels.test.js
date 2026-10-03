/* global globalThis */
// Regression (2026-10-03): the client's Statements → Wallet tab was a blank white screen in production. The portal already
// held a wallet hook for the client (live updates joined); the wallet statement mounted a second one for the same user.
// supabase-js hands back an existing channel with the same name, and adding listeners to a joined channel throws —
// the error took the whole screen down. Each hook instance now has its own channel.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useWallet } from "../hooks/useWallet";

// supabase-js / realtime-js behaviour that matters here: one channel per name, `.on()` throws once it has subscribed.
const mockChannels = new Map();
const mockChain = () => {
  const p = Promise.resolve({ data: null, error: null });
  const obj = new Proxy({}, { get: (_, prop) => (prop === "then" ? p.then.bind(p) : () => obj) });
  return obj;
};
jest.mock("../utils/supabase", () => ({
  supabase: {
    from: () => mockChain(),
    rpc: () => mockChain(),
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: (name) => {
      if (!mockChannels.has(name)) {
        const ch = {
          name, joined: false, removed: false,
          on() { if (this.joined) throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${name} after \`subscribe()\`.`); return this; },
          subscribe() { this.joined = true; return this; },
        };
        mockChannels.set(name, ch);
      }
      return mockChannels.get(name);
    },
    removeChannel: (ch) => { ch.removed = true; mockChannels.delete(ch.name); },
  },
}));

function Probe({ userId }) {
  useWallet(userId, true);
  return null;
}

describe("useWallet live updates", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  it("two screens on the same wallet each get their own channel — no crash, and closing one leaves the other live", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const errors = [];
    const onError = (e) => { errors.push(e?.error?.message || String(e)); e.preventDefault?.(); };
    window.addEventListener("error", onError);
    // the portal's hook, then the statement's hook on the same wallet
    await act(async () => { root.render(<><Probe userId="u1" /></>); });
    await act(async () => { root.render(<><Probe userId="u1" /><Probe userId="u1" /></>); });
    const names = [...mockChannels.keys()];
    expect(names).toHaveLength(2);
    expect(names.every((n) => n.startsWith("wallet_rt_u1_"))).toBe(true);
    expect(errors).toEqual([]);
    // the statement closes: the portal's channel stays subscribed
    await act(async () => { root.render(<><Probe userId="u1" /></>); });
    expect(mockChannels.size).toBe(1);
    expect([...mockChannels.values()][0].joined).toBe(true);
    await act(async () => { root.unmount(); });
    window.removeEventListener("error", onError);
  });
});
