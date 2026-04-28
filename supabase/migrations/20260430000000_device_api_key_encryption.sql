-- Phase 8 마이그레이션: device api_key 암호화 저장 전환
-- 기존 api_key_hash 는 미사용 (Phase 4 에선 shared DEVICE_API_KEY 였음).
-- 이제부터는 access_devices.api_key_encrypted 에 AES-GCM 암호문 저장.
-- 복호화는 Workers 의 DEVICE_KMS_KEY 시크릿으로만 가능.

ALTER TABLE access_devices
  ADD COLUMN IF NOT EXISTS api_key_encrypted text,
  ADD COLUMN IF NOT EXISTS api_key_fingerprint text;

COMMENT ON COLUMN access_devices.api_key_encrypted IS
  'AES-GCM ciphertext (base64). 복호화는 Workers DEVICE_KMS_KEY 로만.';
COMMENT ON COLUMN access_devices.api_key_fingerprint IS
  '마지막 4자리 또는 SHA256 prefix (UI 표시 전용 — 전체 키 노출 금지)';

-- Phase 8 운영 메모:
-- 1) 새 단말기 등록 시 Workers 가 random 32-byte 키 생성 → 암호화 INSERT → CRM 에 1회 평문 표시
-- 2) 기존 mock 단말기는 fallback (env.DEVICE_API_KEY) 사용 (api_key_encrypted=NULL)
-- 3) 키 회전 시 동일 컬럼 UPDATE — 단말기 측에도 새 키 입력 필요
