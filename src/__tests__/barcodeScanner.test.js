import React, { act } from "react";
import { createRoot } from "react-dom/client";
import BarcodeScanner from "../components/BarcodeScanner";

let mockDecode;
jest.mock("jsqr", () => ({ __esModule: true, default: (...a) => mockDecode(...a) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, tracks, getUserMedia;

beforeEach(() => {
  mockDecode = jest.fn(() => null);
  tracks = [{ stop: jest.fn() }];
  getUserMedia = jest.fn(async () => ({ getTracks: () => tracks }));
  Object.defineProperty(global.navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  window.HTMLMediaElement.prototype.play = jest.fn(async () => {});
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  try { await act(async () => root.unmount()); } catch { /* already unmounted by a test */ }
  host.remove(); jest.useRealTimers();
});

const show = async (el) => { await act(async () => { root.render(el); }); };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };

describe("BarcodeScanner", () => {
  it("shows the scan button, and opens a live rear-camera preview on click", async () => {
    await show(<BarcodeScanner onScan={() => {}} />);
    await click(button("Scan a QR code"));
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: expect.objectContaining({ facingMode: { ideal: "environment" } }), audio: false,
    }));
    expect(host.querySelector("video")).not.toBeNull();
  });

  it("a custom label is used for the button", async () => {
    await show(<BarcodeScanner onScan={() => {}} label="Try scanning" />);
    expect(host.textContent).toContain("Try scanning");
  });

  it("cancelling stops every camera track and closes the preview without scanning", async () => {
    const onScan = jest.fn();
    await show(<BarcodeScanner onScan={onScan} />);
    await click(button("Scan a QR code"));
    await click(button("Cancel"));
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(host.querySelector("video")).toBeNull();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("a denied camera shows a clear message and never opens the preview", async () => {
    getUserMedia.mockImplementation(async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); });
    await show(<BarcodeScanner onScan={() => {}} />);
    await click(button("Scan a QR code"));
    expect(host.textContent).toMatch(/camera access was blocked/i);
    expect(host.querySelector("video")).toBeNull();
  });

  it("a camera that can't be reached for another reason shows a generic message, not the permission one", async () => {
    getUserMedia.mockImplementation(async () => { throw new Error("boom"); });
    await show(<BarcodeScanner onScan={() => {}} />);
    await click(button("Scan a QR code"));
    expect(host.textContent).toMatch(/couldn.t reach your camera/i);
    expect(host.textContent).not.toMatch(/camera access was blocked/i);
  });

  it("decoding a frame calls onScan with the raw decoded text, stops the camera, and closes the preview", async () => {
    jest.useFakeTimers();
    const onScan = jest.fn();
    const ctx = { drawImage: jest.fn(), getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4), width: 10, height: 10 })) };
    window.HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx);
    mockDecode = jest.fn(() => ({ data: "KDT-202609-X7K2M9PQ" }));
    await show(<BarcodeScanner onScan={onScan} />);
    await click(button("Scan a QR code"));
    const video = host.querySelector("video");
    Object.defineProperty(video, "videoWidth", { value: 300, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 300, configurable: true });
    await act(async () => { jest.advanceTimersByTime(220); });
    expect(mockDecode).toHaveBeenCalled();
    expect(onScan).toHaveBeenCalledWith("KDT-202609-X7K2M9PQ");
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(host.querySelector("video")).toBeNull();
  });

  it("a decode with no real payload (empty/garbage) keeps scanning instead of closing on nothing", async () => {
    jest.useFakeTimers();
    const onScan = jest.fn();
    const ctx = { drawImage: jest.fn(), getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4), width: 10, height: 10 })) };
    window.HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx);
    mockDecode = jest.fn(() => ({ data: "" }));   // jsQR found something result-shaped, but no real text
    await show(<BarcodeScanner onScan={onScan} />);
    await click(button("Scan a QR code"));
    const video = host.querySelector("video");
    Object.defineProperty(video, "videoWidth", { value: 300, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 300, configurable: true });
    await act(async () => { jest.advanceTimersByTime(220); });
    expect(onScan).not.toHaveBeenCalled();
    expect(host.querySelector("video")).not.toBeNull();   // still scanning, not closed
  });

  it("no result yet keeps scanning quietly — no onScan call, overlay stays open, nothing throws", async () => {
    jest.useFakeTimers();
    const onScan = jest.fn();
    await show(<BarcodeScanner onScan={onScan} />);
    await click(button("Scan a QR code"));
    // videoWidth left at jsdom's default of 0 — no real frame yet, so the scan tick must no-op, not crash
    await act(async () => { jest.advanceTimersByTime(220); jest.advanceTimersByTime(220); });
    expect(onScan).not.toHaveBeenCalled();
    expect(host.querySelector("video")).not.toBeNull();
  });

  it("unmounting mid-scan stops the camera (no leaked stream)", async () => {
    await show(<BarcodeScanner onScan={() => {}} />);
    await click(button("Scan a QR code"));
    await act(async () => { root.unmount(); });
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
  });
});
