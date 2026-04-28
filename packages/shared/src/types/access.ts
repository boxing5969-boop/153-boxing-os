import type { DeniedReason } from "../constants/deniedReasons";

export type CredentialType = "face" | "qr" | "card" | "pin" | "admin" | "visitor";
export type AccessResult = "success" | "denied" | "error";
export type DeviceType = "face_terminal" | "qr_reader" | "card_reader" | "relay" | "kiosk";
export type DeviceVendor =
  | "suprema"
  | "zkteco"
  | "hikvision"
  | "mock"
  | "custom"
  | "other";
export type DeviceStatus = "active" | "inactive" | "error";
export type SyncJobType =
  | "create_user"
  | "update_user"
  | "disable_user"
  | "delete_user"
  | "sync_access_group"
  | "pull_logs";
export type SyncJobStatus = "pending" | "processing" | "success" | "failed";

export interface AccessLog {
  id: string;
  branch_id: string;
  device_id: string | null;
  member_id: string | null;
  credential_type: CredentialType;
  result: AccessResult;
  denied_reason: DeniedReason | null;
  raw_event_id: string | null;
  occurred_at: string;
  created_at: string;
}

export interface AccessDevice {
  id: string;
  branch_id: string;
  device_name: string;
  device_type: DeviceType;
  vendor: DeviceVendor;
  model_name: string | null;
  device_identifier: string | null;
  api_endpoint: string | null;
  api_key_hash: string | null;
  api_key_encrypted?: string | null;
  api_key_fingerprint?: string | null;
  status: DeviceStatus;
  last_seen_at: string | null;
  created_at: string;
}

export interface DeviceSyncJob {
  id: string;
  branch_id: string;
  device_id: string;
  job_type: SyncJobType;
  target_member_id: string | null;
  status: SyncJobStatus;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  processed_at: string | null;
}
