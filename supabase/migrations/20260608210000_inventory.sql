-- Products table
CREATE TABLE IF NOT EXISTS public.products (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_name         TEXT NOT NULL,
  sku                  TEXT DEFAULT '',
  category             TEXT DEFAULT '',
  cost_price           NUMERIC(12,2) DEFAULT 0,
  selling_price        NUMERIC(12,2) DEFAULT 0,
  quantity             INTEGER DEFAULT 0,
  low_stock_threshold  INTEGER DEFAULT 5,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Stock movements table
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('sale','restock','adjustment')),
  quantity    INTEGER NOT NULL,
  unit_price  NUMERIC(12,2) DEFAULT 0,
  notes       TEXT DEFAULT '',
  staff_id    UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_user_id       ON public.products(user_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_user_id      ON public.stock_movements(user_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_product_id   ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_created_at   ON public.stock_movements(created_at DESC);

-- RLS
ALTER TABLE public.products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- Owner policies
CREATE POLICY "owner_all_products" ON public.products
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "owner_all_movements" ON public.stock_movements
  FOR ALL USING (auth.uid() = user_id);

-- Staff read products
CREATE POLICY "staff_read_products" ON public.products
  FOR SELECT USING (
    user_id IN (SELECT owner_id FROM public.staff WHERE id = auth.uid())
  );

-- Staff update products (qty sync)
CREATE POLICY "staff_update_products" ON public.products
  FOR UPDATE USING (
    user_id IN (SELECT owner_id FROM public.staff WHERE id = auth.uid())
  );

-- Staff read + insert movements
CREATE POLICY "staff_read_movements" ON public.stock_movements
  FOR SELECT USING (
    user_id IN (SELECT owner_id FROM public.staff WHERE id = auth.uid())
  );

CREATE POLICY "staff_insert_movements" ON public.stock_movements
  FOR INSERT WITH CHECK (
    user_id IN (SELECT owner_id FROM public.staff WHERE id = auth.uid())
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS products_updated_at ON public.products;
CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
