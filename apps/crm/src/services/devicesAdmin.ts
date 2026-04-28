import { supabase } from "@/integrations/supabase/client";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

export interface RegisterDeviceInput {
  branch_id: string;
  device_name: string;
  device_type: "face_terminal" | "qr_reader" | "card_reader" | "relay" | "kiosk";
  vendor: "suprema" | "zkteco" | "hikvision" | "mock" | "custom" | "other";
  device_identifier?: string;
  model_name?: string;
  api_endpoint?: string;
}

export interface DeviceKeyResult {
  device_id: string;
  api_key: string;
  api_key_fingerprint: string;
}

interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}
interface ApiFailure {
  success: false;
  error: { code: string; message: string };
}
type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionResult = await supabase.auth.getSession();
  const jwt = sessionResult.data.session?.access_token;
  if (!jwt) throw new Error("로그인 세션이 만료됐습니다. 다시 로그인하세요.");

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      ...(init?.headers ?? {}),
    },
  });

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error(`HTTP ${res.status} — 응답 파싱 실패`);
  }

  if (!envelope.success) {
    throw new Error(envelope.error.message ?? `HTTP ${res.status}`);
  }
  return envelope.data;
}

export async function registerDevice(
  input: RegisterDeviceInput
): Promise<DeviceKeyResult> {
  return authedFetch<DeviceKeyResult>("/api/devices/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function rotateDeviceKey(deviceId: string): Promise<DeviceKeyResult> {
  return authedFetch<DeviceKeyResult>(`/api/devices/${deviceId}/rotate-key`, {
    method: "POST",
  });
}
