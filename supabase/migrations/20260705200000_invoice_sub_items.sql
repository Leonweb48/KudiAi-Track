-- Invoice sub-items: parent_item_id (self-referencing FK) + pricing_mode

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS parent_item_id UUID REFERENCES invoice_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS pricing_mode   TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_invoice_items_parent ON invoice_items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id, sort_order);
