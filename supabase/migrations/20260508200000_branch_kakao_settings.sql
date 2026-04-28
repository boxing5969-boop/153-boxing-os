-- ============================================================
-- Branch Kakao AlimTalk settings (per-branch, independent billing)
-- ============================================================

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS kakao_pfid          text,
  ADD COLUMN IF NOT EXISTS kakao_sender_phone  text,
  ADD COLUMN IF NOT EXISTS kakao_tpl_d7        text,
  ADD COLUMN IF NOT EXISTS kakao_tpl_d3        text,
  ADD COLUMN IF NOT EXISTS kakao_tpl_d1        text,
  ADD COLUMN IF NOT EXISTS kakao_api_key_enc   text,
  ADD COLUMN IF NOT EXISTS kakao_api_secret_enc text,
  ADD COLUMN IF NOT EXISTS kakao_enabled       boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.branches.kakao_pfid           IS 'Kakao channel pfId (KA01PF...)';
COMMENT ON COLUMN public.branches.kakao_sender_phone   IS 'Sender phone (no dashes)';
COMMENT ON COLUMN public.branches.kakao_tpl_d7         IS 'AlimTalk template ID for D-7';
COMMENT ON COLUMN public.branches.kakao_tpl_d3         IS 'AlimTalk template ID for D-3';
COMMENT ON COLUMN public.branches.kakao_tpl_d1         IS 'AlimTalk template ID for D-1';
COMMENT ON COLUMN public.branches.kakao_api_key_enc    IS 'AES-GCM encrypted Solapi API key';
COMMENT ON COLUMN public.branches.kakao_api_secret_enc IS 'AES-GCM encrypted Solapi API secret';
COMMENT ON COLUMN public.branches.kakao_enabled        IS 'Whether alimtalk is active for this branch';

-- RPC: save branch kakao settings (branch_admin or hq)
CREATE OR REPLACE FUNCTION public.update_branch_kakao_settings(
  _branch_id           uuid,
  _kakao_pfid          text,
  _kakao_sender_phone  text,
  _kakao_tpl_d7        text DEFAULT NULL,
  _kakao_tpl_d3        text DEFAULT NULL,
  _kakao_tpl_d1        text DEFAULT NULL,
  _kakao_api_key_enc   text DEFAULT NULL,
  _kakao_api_secret_enc text DEFAULT NULL,
  _kakao_enabled       boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE branches SET
    kakao_pfid            = _kakao_pfid,
    kakao_sender_phone    = _kakao_sender_phone,
    kakao_tpl_d7          = _kakao_tpl_d7,
    kakao_tpl_d3          = _kakao_tpl_d3,
    kakao_tpl_d1          = _kakao_tpl_d1,
    kakao_api_key_enc     = COALESCE(NULLIF(_kakao_api_key_enc, ''), kakao_api_key_enc),
    kakao_api_secret_enc  = COALESCE(NULLIF(_kakao_api_secret_enc, ''), kakao_api_secret_enc),
    kakao_enabled         = _kakao_enabled
  WHERE id = _branch_id;
END $$;

GRANT EXECUTE ON FUNCTION public.update_branch_kakao_settings(uuid,text,text,text,text,text,text,text,boolean) TO authenticated;
