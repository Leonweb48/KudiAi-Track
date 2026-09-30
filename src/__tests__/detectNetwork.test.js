import { detectNetwork } from "../utils/phoneNetwork";

// Typing a number switches the bill form to that number's network, so a missing prefix means the order goes out on
// whatever network was selected before — and ClubKonnect refuses an order on the wrong network.
describe("detectNetwork — the network a Nigerian number belongs to", () => {
  it("0704 (the old Visafone range) is MTN", () => {
    expect(detectNetwork("07041234567")).toBe("MTN");
    expect(detectNetwork("0704")).toBe("MTN");
  });

  it("0702 is split: only 07025 and 07026 are MTN", () => {
    expect(detectNetwork("07025123456")).toBe("MTN");
    expect(detectNetwork("07026123456")).toBe("MTN");
    expect(detectNetwork("07021123456")).toBeNull();
    expect(detectNetwork("0702")).toBeNull();
  });

  it("the ranges that already worked still do", () => {
    expect(detectNetwork("08134807312")).toBe("MTN");
    expect(detectNetwork("09131234567")).toBe("MTN");
    expect(detectNetwork("08021234567")).toBe("Airtel");
    expect(detectNetwork("08051234567")).toBe("Glo");
    expect(detectNetwork("08091234567")).toBe("9mobile");
  });

  it("+234 / 234 forms, spaces and dashes", () => {
    expect(detectNetwork("+234 704 123 4567")).toBe("MTN");
    expect(detectNetwork("2347041234567")).toBe("MTN");
    expect(detectNetwork("+234 702 5123456")).toBe("MTN");
    expect(detectNetwork("0802-123-4567")).toBe("Airtel");
  });

  it("too short, unknown or empty → no guess", () => {
    expect(detectNetwork("080")).toBeNull();
    expect(detectNetwork("07991234567")).toBeNull();
    expect(detectNetwork("")).toBeNull();
    expect(detectNetwork(null)).toBeNull();
  });
});
