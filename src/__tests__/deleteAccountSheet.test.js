import React, { act } from "react";
import { createRoot } from "react-dom/client";
import DeleteAccountSheet from "../components/shared/DeleteAccountSheet";
import { callAccountDelete, erasedLines } from "../utils/accountDeletion";

// Plain functions, not jest.fn(): CRA resets jest.fn implementations between tests.
let mockResponses = [];        // queued { data } | { error } for functions.invoke, in call order
let mockCalls = [];
jest.mock("../utils/supabase", () => ({
  supabase: { functions: { invoke: (name, opts) => { mockCalls.push({ name, body: opts.body }); return Promise.resolve(mockResponses.shift() || { data: { ok: true } }); } } },
}));
jest.mock("../utils/logout", () => ({ performLogout: () => Promise.resolve() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host, root;
beforeEach(() => { mockResponses = []; mockCalls = []; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); jest.useFakeTimers(); });
afterEach(() => { act(() => root.unmount()); host.remove(); jest.useRealTimers(); });

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const show = async (props = {}) => { await act(async () => { root.render(<DeleteAccountSheet onClose={() => {}} {...props} />); }); await flush(); };
const httpError = (status, body) => ({ error: { context: { status, clone: () => ({ json: () => Promise.resolve(body) }) } } });
const type = async (el, value) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const button = (label) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(label));

describe("DeleteAccountSheet", () => {
  it("blocked: says exactly what is still open and offers no delete button", async () => {
    mockResponses.push({ data: { ok: true, kinds: ["owner"], can_delete: false, blockers: [
      { code: "wallet_balance", title: "Your wallet still has ₦50.00", hint: "Transfer it to your bank account first, then come back." },
      { code: "staff_active", title: "You still have 2 staff accounts", hint: "Remove your staff first." },
    ] } });
    await show();
    expect(host.textContent).toContain("You can’t delete your account yet");
    expect(host.textContent).toContain("Your wallet still has ₦50.00");
    expect(host.textContent).toContain("You still have 2 staff accounts");
    expect(button("Delete my account")).toBeUndefined();
    expect(mockCalls).toEqual([{ name: "account-delete", body: { action: "check" } }]);
  });

  it("confirm: the delete button stays off until a password is typed AND the box is ticked", async () => {
    mockResponses.push({ data: { ok: true, kinds: ["owner"], can_delete: true, blockers: [] } });
    await show();
    expect(host.textContent).toContain("What gets erased");
    expect(host.textContent).toContain("What we keep");
    expect(host.textContent).toContain("customers, debtors and clients");
    const del = () => button("Delete my account");
    expect(del().disabled).toBe(true);
    await type(host.querySelector("input[type=password]"), "hunter2");
    expect(del().disabled).toBe(true);
    await click(host.querySelector("input[type=checkbox]"));
    expect(del().disabled).toBe(false);
  });

  it("deleting sends the password with confirm:true, then signs out (Done, or automatically)", async () => {
    const out = [];
    mockResponses.push({ data: { ok: true, kinds: ["ajo_client"], can_delete: true, blockers: [] } });
    mockResponses.push({ data: { ok: true } });
    await show({ onDeleted: () => { out.push("out"); return Promise.resolve(); } });
    await type(host.querySelector("input[type=password]"), "hunter2");
    await click(host.querySelector("input[type=checkbox]"));
    await click(button("Delete my account"));
    expect(mockCalls[1]).toEqual({ name: "account-delete", body: { action: "delete", confirm: true, password: "hunter2" } });
    expect(host.textContent).toContain("Your account has been deleted");
    await click(button("Done"));
    expect(out).toEqual(["out"]);
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(out).toEqual(["out"]);          // never signed out twice
  });

  it("waiting on the confirmation screen signs out on its own", async () => {
    const out = [];
    mockResponses.push({ data: { ok: true, kinds: ["owner"], can_delete: true, blockers: [] } });
    mockResponses.push({ data: { ok: true } });
    await show({ onDeleted: () => { out.push("out"); return Promise.resolve(); } });
    await type(host.querySelector("input[type=password]"), "pw");
    await click(host.querySelector("input[type=checkbox]"));
    await click(button("Delete my account"));
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(out).toEqual(["out"]);
  });

  it("wrong password: shows the message, stays on the form, keeps what was typed", async () => {
    mockResponses.push({ data: { ok: true, kinds: ["owner"], can_delete: true, blockers: [] } });
    mockResponses.push(httpError(403, { ok: false, code: "wrong_password", error: "That password is not correct." }));
    await show();
    await type(host.querySelector("input[type=password]"), "nope");
    await click(host.querySelector("input[type=checkbox]"));
    await click(button("Delete my account"));
    expect(host.textContent).toContain("That password is not correct.");
    expect(host.textContent).not.toContain("Your account has been deleted");
    expect(host.querySelector("input[type=password]").value).toBe("nope");
  });

  it("something opened up since the check (409): switches to the blocked list", async () => {
    mockResponses.push({ data: { ok: true, kinds: ["owner"], can_delete: true, blockers: [] } });
    mockResponses.push(httpError(409, { ok: false, code: "blocked", blockers: [{ code: "wallet_balance", title: "Your wallet still has ₦10.00", hint: "x" }] }));
    await show();
    await type(host.querySelector("input[type=password]"), "pw");
    await click(host.querySelector("input[type=checkbox]"));
    await click(button("Delete my account"));
    expect(host.textContent).toContain("You can’t delete your account yet");
    expect(host.textContent).toContain("Your wallet still has ₦10.00");
  });

  it("a failed check offers Try again instead of a dead end", async () => {
    mockResponses.push(httpError(500, { error: "Could not check your account. Try again." }));
    mockResponses.push({ data: { ok: true, kinds: [], can_delete: true, blockers: [] } });
    await show();
    expect(host.textContent).toContain("Could not check your account");
    await click(button("Try again"));
    expect(host.textContent).toContain("What gets erased");
  });
});

describe("callAccountDelete / erasedLines", () => {
  it("returns the parsed body for a non-2xx and a plain message for a network failure", async () => {
    const bad = { functions: { invoke: () => Promise.resolve(httpError(409, { code: "blocked" })) } };
    expect(await callAccountDelete({}, bad)).toEqual({ ok: false, status: 409, data: { code: "blocked" } });
    const down = { functions: { invoke: () => Promise.reject(new Error("offline")) } };
    const r = await callAccountDelete({}, down);
    expect(r.ok).toBe(false);
    expect(r.data.error).toContain("Network problem");
  });

  it("lists what is erased for each kind of account", () => {
    expect(erasedLines(["owner"]).join("|")).toContain("customers, debtors and clients");
    expect(erasedLines(["ajo_client"]).join("|")).toContain("savings profile");
    expect(erasedLines(["coop_member"]).join("|")).toContain("cooperative membership");
    expect(erasedLines([]).length).toBeGreaterThanOrEqual(3);
  });
});
