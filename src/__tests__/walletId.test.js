import { walletIdError, digits11, isElevenDigits } from "../utils/walletId";

describe("walletIdError — a BVN or a NIN opens a wallet", () => {
  it("accepts a BVN alone", () => expect(walletIdError("12345678901", "", false)).toBe(""));
  it("accepts a NIN alone", () => expect(walletIdError("", "12345678901", false)).toBe(""));
  it("accepts both", () => expect(walletIdError("12345678901", "10987654321", false)).toBe(""));

  it("asks for one when neither is given", () => {
    expect(walletIdError("", "", false)).toBe("Enter your BVN or your NIN");
  });

  it("test mode needs neither (the server substitutes a placeholder)", () => {
    expect(walletIdError("", "", true)).toBe("");
  });

  it("a number that is typed must be exactly 11 digits — even when the other one is fine", () => {
    expect(walletIdError("12345", "", false)).toBe("Your BVN must be exactly 11 digits");
    expect(walletIdError("", "123", false)).toBe("Your NIN must be exactly 11 digits");
    expect(walletIdError("12345", "10987654321", false)).toBe("Your BVN must be exactly 11 digits");
    expect(walletIdError("12345678901", "1098", false)).toBe("Your NIN must be exactly 11 digits");
    expect(walletIdError("123456789012", "", false)).toBe("Your BVN must be exactly 11 digits");
  });

  it("digits11 strips everything but digits and caps at 11", () => {
    expect(digits11("12ab345-678901234")).toBe("12345678901");
    expect(digits11(null)).toBe("");
  });

  it("isElevenDigits", () => {
    expect(isElevenDigits("12345678901")).toBe(true);
    expect(isElevenDigits("1234567890")).toBe(false);
    expect(isElevenDigits("1234567890a")).toBe(false);
    expect(isElevenDigits(undefined)).toBe(false);
  });
});
