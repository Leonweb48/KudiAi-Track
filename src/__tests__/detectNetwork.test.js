import { detectNetwork, networkMismatch, networkMismatchMessage } from "../shared/phoneNetwork";

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

// Airtime and data may only go to the number's own network: the bill form keeps Pay off and the bill server refuses.
describe("networkMismatch — a network selected that isn't the number's own", () => {
  it("names the number's own network when another is selected", () => {
    expect(networkMismatch("08021234567", "MTN")).toBe("Airtel");
    expect(networkMismatch("08031234567", "Glo")).toBe("MTN");
    expect(networkMismatch("+234 805 123 4567", "9mobile")).toBe("Glo");
    expect(networkMismatch("08091234567", "Airtel")).toBe("9mobile");
  });

  it("no mismatch when they agree, however the network is written", () => {
    expect(networkMismatch("08031234567", "MTN")).toBeNull();
    expect(networkMismatch("08051234567", "GLO")).toBeNull();
    expect(networkMismatch("08091234567", "t2mobile")).toBeNull();   // 9mobile's new name on the bill server
    expect(networkMismatch("08091234567", "9mobile")).toBeNull();
  });

  it("a number whose network isn't known is never blocked", () => {
    expect(networkMismatch("08011111111", "Glo")).toBeNull();
    expect(networkMismatch("07021123456", "Airtel")).toBeNull();   // 0702 other than 07025/07026
    expect(networkMismatch("080", "Airtel")).toBeNull();
    expect(networkMismatch("", "MTN")).toBeNull();
  });
});

describe("networkMismatchMessage", () => {
  it("tells the customer which network to choose", () => {
    expect(networkMismatchMessage("Airtel", "MTN")).toBe("This is an Airtel number, not MTN. Choose Airtel to continue.");
    expect(networkMismatchMessage("Glo", "t2mobile")).toBe("This is a Glo number, not 9mobile. Choose Glo to continue.");
  });

  it("never reads as a dropped connection, so the app refunds instead of holding the order", () => {
    // Keep in step with CK_NET_ERR in src/screens/BillPayments.jsx: a bill server error matching it is held, not refunded.
    const CK_NET_ERR = /network|timeout|timed ?out|failed to fetch|failed to send a request|load failed|connection|aborted|ECONNRESET|socket|gateway|502|503|504|non-2xx|FunctionsFetchError|FunctionsRelayError|edge function/i;
    for (const own of ["MTN", "Airtel", "Glo", "9mobile"]) {
      for (const sel of ["MTN", "Airtel", "Glo", "9mobile", "t2mobile"]) {
        expect(CK_NET_ERR.test(networkMismatchMessage(own, sel))).toBe(false);
      }
    }
  });
});
