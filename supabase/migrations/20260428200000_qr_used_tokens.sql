-- Phase 4 마이그레이션: QR 1회용 토큰 nonce 추적
-- 목적: 같은 QR 토큰을 두 번 사용하지 못하게 차단 (replay protection)
-- 운영: Workers cron (또는 pg_cron) 으로 cleanup_qr_used_tokens() 주기적 실행

CREATE TABLE qr_used_tokens (
  nonce      text PRIMARY KEY,
  member_id  uuid REFERENCES members(id) ON DELETE SET NULL,
  used_at    timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX idx_qr_used_expires ON qr_used_tokens(expires_at);

CREATE OR REPLACE FUNCTION public.cleanup_qr_used_tokens()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM qr_used_tokens WHERE expires_at < now() RETURNING 1
  )
  SELECT count(*)::int FROM deleted;
$$;

-- RLS — service_role 만 사용 (정책 없음 = authenticated 전부 차단)
ALTER TABLE qr_used_tokens ENABLE ROW LEVEL SECURITY;
