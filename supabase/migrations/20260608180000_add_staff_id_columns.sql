-- Add staff_id tracking columns to credits and aso_clients
ALTER TABLE public.credits     ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE public.aso_clients ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL;
