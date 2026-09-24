import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { customerName, customerPhone, customerEmail } from "./flwCustomer.ts";

// The patterns Flutterwave enforces (copied from its API reference; each was confirmed against the live business account).
const NAME_RE = /^(?![ ,.'-]*$)[A-Za-z ,.'-]{2,50}$/;

Deno.test("names: whatever goes in, both parts satisfy Flutterwave's pattern", () => {
  const inputs = [
    "Amaya & Co. Technologies", "Ada & Sons 2 Ltd", "J Okafor", "Chukwuemeka", "", "   ", "1234", "&&&", "...", "O'Brien-Smith Jr.",
    "Ọlá Adéwálé", "Zoë Müller", "A".repeat(80) + " " + "B".repeat(80), "Store2 Owner", "Mary  Jane   Watson", "-", "Ada 1",
  ];
  for (const s of inputs) {
    const { first, last } = customerName(s);
    assertEquals(NAME_RE.test(first), true, `first of ${JSON.stringify(s)} -> ${JSON.stringify(first)}`);
    assertEquals(NAME_RE.test(last), true, `last of ${JSON.stringify(s)} -> ${JSON.stringify(last)}`);
  }
});

Deno.test("names: a business name keeps its meaning", () => {
  assertEquals(customerName("Amaya & Co. Technologies"), { first: "Amaya", last: "and Co. Technologies" });
  assertEquals(customerName("Ada Obi"), { first: "Ada", last: "Obi" });
  assertEquals(customerName("Mary Jane Watson"), { first: "Mary", last: "Jane Watson" });
  assertEquals(customerName("Zoë Müller"), { first: "Zoe", last: "Muller" });
});

Deno.test("names: a single letter gets a period, a missing part falls back", () => {
  assertEquals(customerName("J Okafor"), { first: "J.", last: "Okafor" });
  assertEquals(customerName("Chukwuemeka"), { first: "Chukwuemeka", last: "Owner" });
  assertEquals(customerName("Chukwuemeka", "User"), { first: "Chukwuemeka", last: "User" });
  assertEquals(customerName(""), { first: "KudiAI", last: "Owner" });
  assertEquals(customerName("1234"), { first: "KudiAI", last: "Owner" });
});

Deno.test("phone: 7–10 digits, country code stripped, leading zero dropped", () => {
  assertEquals(customerPhone("08012345678"), { country_code: "234", number: "8012345678" });
  assertEquals(customerPhone("2348012345678"), { country_code: "234", number: "8012345678" });
  assertEquals(customerPhone("+234 801 234 5678"), { country_code: "234", number: "8012345678" });
  assertEquals(customerPhone("8012345678"), { country_code: "234", number: "8012345678" });
  assertEquals(customerPhone("80123456789"), { country_code: "234", number: "0123456789" });   // 11 digits -> last 10 (never > 10)
  assertEquals(customerPhone("12345"), null);
  assertEquals(customerPhone(""), null);
  assertEquals(customerPhone(null as unknown as string), null);
});

Deno.test("email: valid ones pass through, anything else becomes the fallback", () => {
  assertEquals(customerEmail("ada.obi@example.com", "fb@kudiai.app"), "ada.obi@example.com");
  assertEquals(customerEmail("  ada@example.com ", "fb@kudiai.app"), "ada@example.com");
  assertEquals(customerEmail("not-an-email", "fb@kudiai.app"), "fb@kudiai.app");
  assertEquals(customerEmail("o'brien@example.com", "fb@kudiai.app"), "fb@kudiai.app");
  assertEquals(customerEmail("", "fb@kudiai.app"), "fb@kudiai.app");
  assertEquals(customerEmail(null, "fb@kudiai.app"), "fb@kudiai.app");
});
