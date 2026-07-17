-- Auto-stub support: products auto-created at point of sale get flagged for costing.
-- source: 'manual' (default) | 'auto_sale' (created by POS flow)
-- needs_costing: true until owner sets cost_price + opening qty

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS source        TEXT    NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS needs_costing BOOLEAN NOT NULL DEFAULT false;

-- Index so the "Needs Costing" queue query is fast
CREATE INDEX IF NOT EXISTS idx_products_needs_costing
  ON products (user_id, needs_costing)
  WHERE needs_costing = true;
