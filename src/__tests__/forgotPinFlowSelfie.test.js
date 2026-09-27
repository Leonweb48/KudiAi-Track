import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ForgotPinFlow from "../components/ForgotPinFlow";

let mockSubmit;
jest.mock("../utils/securitySelfie", () => ({ submitSecuritySelfie: (...a) => mockSubmit(...a) }));
// SelfieCapture already has its own dedicated test suite (selfieCapture.test.js) — stub it here so this file
// only exercises ForgotPinFlow's OWN wiring: does it insert the step, call submit with the right kind, and react
// correctly to success/failure.
jest.mock("../components/SelfieCapture", () => (props) => (
  <div>
    <button type="button" onClick={() => props.onCapture("data:image/jpeg;base64,FAKE")}>MockCapture</button>
    {props.value && <span>captured-thumbnail</span>}
  </div>
));
jest.mock("../utils/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { email: "o@example.com" } } } }),
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ error: null }),
    },
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => {
  mockSubmit = jest.fn(async () => ({ ok: true }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

// ForgotPinFlow waits a real 150ms after the last keypad digit before acting on it — wait past that, not just microtasks.
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 250)); }); };
const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };

const mockPinLock = (overrides = {}) => ({
  authorizeReset: jest.fn(async () => ({ data: { reset_token: "tok-1" } })),
  resetAppPin: jest.fn(async () => ({ data: { success: true } })),
  resetTxnPin: jest.fn(async () => ({ data: { success: true } })),
  refetch: jest.fn(async () => {}),
  unlock: jest.fn(),
  ...overrides,
});

// Drives from the initial "send" screen through OTP entry to the point where authorizeReset resolves —
// the moment the selfie step should appear.
async function reachSelfieStep(pinLock) {
  await act(async () => { root.render(<ForgotPinFlow pinLock={pinLock} onCancel={() => {}} />); });
  await click(button("Send Verification Code"));
  for (const d of "123456") await click(button(String(d)));
}

describe("ForgotPinFlow — security selfie step", () => {
  it("is inserted right after OTP verification succeeds, before any new PIN can be set", async () => {
    const pinLock = mockPinLock();
    await reachSelfieStep(pinLock);
    expect(pinLock.authorizeReset).toHaveBeenCalledTimes(1);
    expect(host.textContent).toMatch(/one more step/i);
    expect(host.textContent).not.toMatch(/new app lock pin/i);
    expect(button("MockCapture")).toBeDefined();
  });

  it("a captured selfie is submitted as kind 'pin_reset', and success moves on to setting a new PIN", async () => {
    const pinLock = mockPinLock();
    await reachSelfieStep(pinLock);
    await click(button("MockCapture"));
    expect(mockSubmit).toHaveBeenCalledWith("pin_reset", "data:image/jpeg;base64,FAKE");
    expect(host.textContent).toMatch(/new app lock pin/i);
  });

  it("a failed submit shows the error and stays on the selfie step — never silently lets the reset through", async () => {
    mockSubmit = jest.fn(async () => ({ ok: false, error: "Couldn't save the photo — please try again." }));
    const pinLock = mockPinLock();
    await reachSelfieStep(pinLock);
    await click(button("MockCapture"));
    expect(host.textContent).toMatch(/couldn.t save the photo/i);
    expect(host.textContent).toMatch(/one more step/i);
    expect(host.textContent).not.toMatch(/new app lock pin/i);
  });

  it("cancelling from the selfie step calls onCancel, same as any other step", async () => {
    const onCancel = jest.fn();
    const pinLock = mockPinLock();
    await act(async () => { root.render(<ForgotPinFlow pinLock={pinLock} onCancel={onCancel} />); });
    await click(button("Send Verification Code"));
    for (const d of "123456") await click(button(String(d)));
    await click(button("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
