-- Adds a nullable JSONB column to transactions for multi-item sales/expenses.
-- Each element: { name, qty, unitPrice, lineTotal, productId, costPrice, needsCosting }
-- NULL means a legacy single-item transaction (backwards-compatible; engine falls
-- through to the existing item_name / quantity / amount columns).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS line_items JSONB DEFAULT NULL;
