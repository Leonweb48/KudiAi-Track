import React, { act } from "react";
import { createRoot } from "react-dom/client";
import fs from "fs";
import path from "path";
import SelfieCapture from "../components/SelfieCapture";

// Plain variables the mocks read (CRA resets jest.fn implementations between tests)
let mockNative = false;
jest.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mockNative } }));
let mockGetPhoto;
jest.mock("@capacitor/camera", () => ({
  Camera: { getPhoto: (...a) => mockGetPhoto(...a) },
  CameraResultType: { DataUrl: "dataUrl" }, CameraSource: { Camera: "CAMERA" }, CameraDirection: { Front: "FRONT" },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { mockNative = false; mockGetPhoto = jest.fn(async () => ({ dataUrl: "data:image/jpeg;base64,AAAA" })); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const show = async (el) => { await act(async () => { root.render(el); }); };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };

describe("SelfieCapture — captured state", () => {
  it("with a value: shows a thumbnail and Retake, not the capture prompt", async () => {
    await show(<SelfieCapture value="data:image/jpeg;base64,X" onCapture={() => {}} />);
    expect(host.textContent).toContain("Selfie captured");
    expect(button("Retake")).not.toBeUndefined();
    expect(button("Take a selfie")).toBeUndefined();
    expect(host.querySelector("img").src).toBe("data:image/jpeg;base64,X");
  });

  it("with no value: shows the capture prompt, not a thumbnail", async () => {
    await show(<SelfieCapture value="" onCapture={() => {}} />);
    expect(host.textContent).toContain("Take a selfie");
    expect(host.querySelector("img")).toBeNull();
  });

  it("a custom label is used for the prompt", async () => {
    await show(<SelfieCapture value="" onCapture={() => {}} label="Verify your face" />);
    expect(host.textContent).toContain("Verify your face");
  });
});

describe("SelfieCapture — native (Capacitor Camera, front-facing, camera-only)", () => {
  it("captures via the front camera, never the gallery, and hands back the data URI", async () => {
    mockNative = true;
    const captured = [];
    await show(<SelfieCapture value="" onCapture={(u) => captured.push(u)} />);
    await click(button("Take a selfie"));
    expect(mockGetPhoto).toHaveBeenCalledTimes(1);
    const opts = mockGetPhoto.mock.calls[0][0];
    expect(opts.source).toBe("CAMERA");            // never CameraSource.Photos (the gallery) — a live check needs a live photo
    expect(opts.direction).toBe("FRONT");
    expect(opts.resultType).toBe("dataUrl");
    expect(opts.saveToGallery).toBe(false);
    expect(opts.allowEditing).toBe(false);
    expect(captured).toEqual(["data:image/jpeg;base64,AAAA"]);
  });

  it("downscales to a sane size for Youverify's limits (48–4096 px, ≤1MB) without upscaling small photos", async () => {
    mockNative = true;
    await show(<SelfieCapture value="" onCapture={() => {}} />);
    await click(button("Take a selfie"));
    const opts = mockGetPhoto.mock.calls[0][0];
    expect(opts.width).toBeLessThanOrEqual(1000);
    expect(opts.height).toBeLessThanOrEqual(1000);
    expect(opts.quality).toBeGreaterThan(0);
    expect(opts.quality).toBeLessThanOrEqual(100);
  });

  it("a camera error shows a message and never calls onCapture", async () => {
    mockNative = true;
    mockGetPhoto = jest.fn(async () => { throw new Error("Something went wrong"); });
    const captured = [];
    await show(<SelfieCapture value="" onCapture={(u) => captured.push(u)} />);
    await click(button("Take a selfie"));
    expect(captured).toEqual([]);
    expect(host.textContent).toMatch(/couldn.t open the camera/i);
  });

  it("the user cancelling the native camera is silent — no error message shown", async () => {
    mockNative = true;
    mockGetPhoto = jest.fn(async () => { throw new Error("User cancelled photos app"); });
    await show(<SelfieCapture value="" onCapture={() => {}} />);
    await click(button("Take a selfie"));
    expect(host.textContent).not.toMatch(/couldn.t open the camera/i);
  });

  it("never opens the web live-preview overlay on native", async () => {
    mockNative = true;
    await show(<SelfieCapture value="" onCapture={() => {}} />);
    await click(button("Take a selfie"));
    expect(host.querySelector("video")).toBeNull();
  });
});

describe("SelfieCapture — web (getUserMedia)", () => {
  let tracks, getUserMedia;
  beforeEach(() => {
    tracks = [{ stop: jest.fn() }];
    getUserMedia = jest.fn(async () => ({ getTracks: () => tracks }));
    Object.defineProperty(global.navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    window.HTMLMediaElement.prototype.play = jest.fn(async () => {});
  });

  it("asks for the FRONT camera only (a selfie, not any camera) and opens a live preview with capture/cancel controls", async () => {
    await show(<SelfieCapture value="" onCapture={() => {}} />);
    await click(button("Take a selfie"));
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: "user" }), audio: false }));
    expect(host.querySelector("video")).not.toBeNull();
    expect(button("Cancel")).not.toBeUndefined();
    expect(host.querySelector('button[aria-label="Capture"]')).not.toBeNull();
  });

  it("cancelling stops every camera track and closes the preview without capturing", async () => {
    const captured = [];
    await show(<SelfieCapture value="" onCapture={(u) => captured.push(u)} />);
    await click(button("Take a selfie"));
    await click(button("Cancel"));
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(host.querySelector("video")).toBeNull();
    expect(captured).toEqual([]);
  });

  it("a denied camera shows a clear message and never opens the preview", async () => {
    getUserMedia.mockImplementation(async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); });
    await show(<SelfieCapture value="" onCapture={() => {}} />);
    await click(button("Take a selfie"));
    expect(host.textContent).toMatch(/camera access was blocked/i);
    expect(host.querySelector("video")).toBeNull();
  });

  it("capturing draws a MIRRORED frame to a canvas, produces a JPEG data URI, hands it to onCapture, and stops the stream", async () => {
    const ctx = { translate: jest.fn(), scale: jest.fn(), drawImage: jest.fn() };
    const getContext = jest.fn(() => ctx);
    const toDataURL = jest.fn(() => "data:image/jpeg;base64,CAPTURED");
    window.HTMLCanvasElement.prototype.getContext = getContext;
    window.HTMLCanvasElement.prototype.toDataURL = toDataURL;
    const captured = [];
    await show(<SelfieCapture value="" onCapture={(u) => captured.push(u)} />);
    await click(button("Take a selfie"));
    const video = host.querySelector("video");
    Object.defineProperty(video, "videoWidth", { value: 1280, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 960, configurable: true });
    await click(host.querySelector('button[aria-label="Capture"]'));
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1);                    // mirrored, to match what the person saw in the live preview
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", expect.any(Number));
    expect(captured).toEqual(["data:image/jpeg;base64,CAPTURED"]);
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);                  // the camera is released once a photo is taken
    expect(host.querySelector("video")).toBeNull();                   // and the overlay closes
  });

  it("the downscale keeps the aspect ratio and never enlarges an already-small frame", async () => {
    await show(<SelfieCapture value="" onCapture={() => {}} />);
    await click(button("Take a selfie"));
    const video = host.querySelector("video");
    Object.defineProperty(video, "videoWidth", { value: 300, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 200, configurable: true });
    let capturedCanvas = null;
    const origCreate = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tag) => { const el = origCreate(tag); if (tag === "canvas") capturedCanvas = el; return el; });
    window.HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ translate() {}, scale() {}, drawImage() {} }));
    window.HTMLCanvasElement.prototype.toDataURL = jest.fn(() => "data:image/jpeg;base64,X");
    await click(host.querySelector('button[aria-label="Capture"]'));
    expect(capturedCanvas.width).toBe(300); expect(capturedCanvas.height).toBe(200);   // no upscaling
    document.createElement.mockRestore();
  });

  it("capturing before the video has real dimensions does nothing (never sends a blank frame)", async () => {
    const captured = [];
    await show(<SelfieCapture value="" onCapture={(u) => captured.push(u)} />);
    await click(button("Take a selfie"));
    // videoWidth left at 0 (jsdom default) — no explicit dimensions set
    await click(host.querySelector('button[aria-label="Capture"]'));
    expect(captured).toEqual([]);
    expect(host.querySelector("video")).not.toBeNull();   // the overlay stays open, nothing was captured
  });
});

// The server refuses a mismatched selfie result silently otherwise being ignored — every place that collects one must actually send it.
describe("every touch point that can collect a selfie actually sends it", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  it.each([
    ["hooks/useWallet.js", "selfie = \"\") => invoke(\"provision-account\", { bvn, nin, consent: kycConsentGiven(), ...(selfie ? { selfie } : {}) })"],
    ["hooks/useWallet.js", "selfie = \"\") => invoke(\"provision-account\", { bvn, nin, migrate: true, consent: kycConsentGiven(), ...(selfie ? { selfie } : {}) })"],
    ["hooks/useWalletMigrationGate.js", "action: \"provision-account\", bvn, nin, migrate: true, consent: kycConsentGiven(), ...(selfie ? { selfie } : {})"],
    ["screens/Wallet.jsx", "await w.provisionAccount(bvn, nin, selfie);"],
    ["components/StaffWalletPanel.jsx", "await wallet.provisionAccount(bvn, nin, selfie);"],
    ["screens/AjoMemberPortal.jsx", "await wallet.provisionAccount(bvn, nin, selfie);"],
    ["components/WalletMigrationCard.jsx", "await api.migrateAccount(bvn, nin, selfie);"],
    ["screens/Onboarding.jsx", "await wallet.provisionAccount(bvn, walletNin, walletSelfie);"],
    ["screens/Verification.jsx", "consent: kycConsentGiven(), ...(selfie ? { selfie } : {}) }"],
  ])("%s sends the captured selfie", (file, snippet) => { expect(read(file)).toContain(snippet); });

  it.each([
    ["components/WalletIdFields.jsx"], ["components/WalletTierCard.jsx"], ["screens/Onboarding.jsx"], ["screens/Verification.jsx"],
  ])("%s renders SelfieCapture", (file) => { expect(read(file)).toContain("<SelfieCapture"); });

  it.each([
    ["components/WalletIdFields.jsx"], ["components/WalletTierCard.jsx"], ["screens/Onboarding.jsx"], ["screens/Verification.jsx"],
  ])("%s gates it behind kycSelfieRequired — never shown while the switch is off", (file) => { expect(read(file)).toMatch(/kycSelfieRequired.*SelfieCapture/s); });
});
