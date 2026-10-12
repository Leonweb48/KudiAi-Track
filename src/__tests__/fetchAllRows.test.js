import { fetchAllRows } from "../hooks/useStore";

// A business's records used to load in ONE request, which the API caps at 1000 rows — older sales, bills and credits
// silently vanished once a shop passed 1000. fetchAllRows pages through them.
function fakeTable(n, { failAt = null } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: `r${String(n - i).padStart(5, "0")}` }));
  const calls = [];
  const make = () => {
    const q = {
      order: () => q,
      range: async (from, to) => {
        calls.push([from, to]);
        if (failAt !== null && from >= failAt) return { data: null, error: { message: "boom" } };
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    return q;
  };
  return { rows, calls, make };
}

test("loads every row past the 1000-row cap, in order, with no gaps or repeats", async () => {
  const t = fakeTable(2345);
  const { data, error } = await fetchAllRows(t.make);
  expect(error).toBeNull();
  expect(data).toHaveLength(2345);
  expect(new Set(data.map((r) => r.id)).size).toBe(2345);
  expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
});

test("a small shop is still one request", async () => {
  const t = fakeTable(332);
  const { data } = await fetchAllRows(t.make);
  expect(data).toHaveLength(332);
  expect(t.calls).toHaveLength(1);
});

test("exactly 1000 rows asks once more and stops", async () => {
  const t = fakeTable(1000);
  const { data } = await fetchAllRows(t.make);
  expect(data).toHaveLength(1000);
  expect(t.calls).toHaveLength(2);
});

test("an error on the first page is reported, not hidden as an empty list", async () => {
  const t = fakeTable(10, { failAt: 0 });
  const { data, error } = await fetchAllRows(t.make);
  expect(data).toBeNull();
  expect(error).toBeTruthy();
});
