CREATE TABLE IF NOT EXISTS public.fund_ai_summary (
  code         text PRIMARY KEY REFERENCES public.funds(code) ON DELETE CASCADE,
  summary      text NOT NULL,
  model        text,
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fund_ai_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fund_ai_summary public read" ON public.fund_ai_summary;
CREATE POLICY "fund_ai_summary public read" ON public.fund_ai_summary FOR SELECT USING (true);
