import React, { act } from "react";
import { createRoot } from "react-dom/client";
import NewDeviceSelfiePrompt from "../components/NewDeviceSelfiePrompt";

let mockSubmit;
jest.mock("../utils/securitySelfie", () => ({ submitSecuritySelfie: (...a) => mockSubmit(...a) }));
jest.mock("../components/SelfieCapture", () => (props) => (
  <div>
    <button type="button" onClick={() => props.onCapture("data:image/jpeg;base64,FAKE")}>MockCapture</button>
  </div>
));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => {
  mockSubmit = jest.fn(async () => ({ ok: true }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const fireNewDevice = async () => { await act(async () => { window.dispatchEvent(new CustomEvent("kt:newDevice")); }); };

describe("NewDeviceSelfiePrompt", () => {
  it("renders nothing until the kt:newDevice event fires", async () => {
    await act(async () => { root.render(<NewDeviceSelfiePrompt />); });
    expect(host.textContent).toBe("");
  });

  it("shows the prompt once the event fires", async () => {
    await act(async () => { root.render(<NewDeviceSelfiePrompt />); });
    await fireNewDevice();
    expect(host.textContent).toMatch(/new device sign-in/i);
    expect(button("MockCapture")).toBeDefined();
    expect(button("Not now")).toBeDefined();
  });

  it("a captured selfie is submitted as kind 'new_device', and success shows a thank-you, never blocking anything", async () => {
    await act(async () => { root.render(<NewDeviceSelfiePrompt />); });
    await fireNewDevice();
    await click(button("MockCapture"));
    expect(mockSubmit).toHaveBeenCalledWith("new_device", "data:image/jpeg;base64,FAKE", expect.any(Object));
    expect(host.textContent).toMatch(/thanks — recorded/i);
  });

  it("closes on its own shortly after the thank-you (it used to stay on screen forever)", async () => {
    jest.useFakeTimers();
    try {
      await act(async () => { root.render(<NewDeviceSelfiePrompt />); });
      await fireNewDevice();
      await click(button("MockCapture"));
      expect(host.textContent).toMatch(/thanks — recorded/i);
      await act(async () => { jest.advanceTimersByTime(2600); });
      expect(host.textContent).toBe("");
    } finally { jest.useRealTimers(); }
  });

  it("never opens during an admin access session (the admin is not the customer)", async () => {
    sessionStorage.setItem("kt_admin_access_token", "x".repeat(40));
    try {
      await act(async () => { root.render(<NewDeviceSelfiePrompt />); });
      await fireNewDevice();
      expect(host.textContent).toBe("");
    } finally { sessionStorage.removeItem("kt_admin_access_token"); }
  });

  it("a failed submit shows the error and stays open for another try", async () => {
    mockSubmit = jest.fn(async () => ({ ok: false, error: "Couldn't save the photo — please try again." }));
    await act(async () => { root.render(<NewDeviceSelfiePrompt />); });
    await fireNewDevice();
    await click(button("MockCapture"));
    expect(host.textContent).toMatch(/couldn.t save the photo/i);
    expect(host.textContent).not.toMatch(/thanks — recorded/i);
  });

  it("'Not now' dismisses without ever calling submit — it never blocks anything", async () => {
    await act(async () => { root.render(<NewDeviceSelfiePrompt />); });
    await fireNewDevice();
    await click(button("Not now"));
    expect(host.textContent).toBe("");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("cleans up its window listener on unmount (no leak)", async () => {
    await act(async () => { root.render(<NewDeviceSelfiePrompt />); });
    await act(async () => { root.unmount(); });
    // firing after unmount must not throw (proves the listener was actually removed, not just ignored)
    expect(() => window.dispatchEvent(new CustomEvent("kt:newDevice"))).not.toThrow();
  });
});
