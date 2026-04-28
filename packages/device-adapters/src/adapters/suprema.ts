import type {
  AccessDeviceAdapter,
  AccessDeviceMember,
  AccessGroup,
  AdapterContext,
  VendorAccessLog,
} from "../interface";

/**
 * SupremaAdapter — Phase 8 scaffold (BioStar 2 API 연동 가이드).
 *
 * ⚠ 주의: 본 구현은 BioStar 2 의 일반 패턴을 모사한 골격입니다.
 *   실제 endpoint·헤더·페이로드는 Suprema 와 SDK/문서 계약 후 채워넣어야 합니다.
 *   현재는 fetch 기반 구조 + 에러 핸들링만 잡혀 있어,
 *   SDK 명세 확보 시 메서드 본문만 수정하면 됩니다.
 *
 * 인증: ctx.device_api_key 를 BS-Session-ID 헤더로 전달.
 *   실 운영에서는 별도 /api/login 호출로 세션 발급 후 쿠키/헤더 사용 가능.
 */

interface BioStarResult {
  code?: number;
  message?: string;
}

interface BioStarResponse<T> {
  Response?: T;
  Result?: BioStarResult;
}

async function bioStar<T>(
  ctx: AdapterContext,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  if (!ctx.base_url) {
    throw new Error("Suprema: ctx.base_url required (e.g. https://biostar.example.com)");
  }
  const url = `${ctx.base_url.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "BS-Session-ID": ctx.device_api_key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Suprema ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => ({}))) as BioStarResponse<T>;
  if (json.Result?.code && json.Result.code !== 0) {
    throw new Error(
      `Suprema ${path} result.code=${json.Result.code}: ${json.Result.message ?? ""}`
    );
  }
  return (json.Response ?? (json as unknown as T)) as T;
}

export class SupremaAdapter implements AccessDeviceAdapter {
  async createUser(ctx: AdapterContext, member: AccessDeviceMember): Promise<string> {
    const body = {
      Users: [
        {
          user_id: member.id,
          name: member.name,
          phone_number: member.phone ?? "",
        },
      ],
    };
    const res = await bioStar<{ rows?: { user_id: string }[] }>(
      ctx,
      "POST",
      "/api/users",
      body
    );
    return res.rows?.[0]?.user_id ?? member.id;
  }

  async updateUser(
    ctx: AdapterContext,
    member: AccessDeviceMember,
    vendor_user_id: string
  ): Promise<void> {
    await bioStar(ctx, "PUT", `/api/users/${encodeURIComponent(vendor_user_id)}`, {
      User: { name: member.name, phone_number: member.phone ?? "" },
    });
  }

  async disableUser(ctx: AdapterContext, vendor_user_id: string): Promise<void> {
    await bioStar(
      ctx,
      "PUT",
      `/api/users/${encodeURIComponent(vendor_user_id)}/disabled`,
      { disabled: true }
    );
  }

  async deleteUser(ctx: AdapterContext, vendor_user_id: string): Promise<void> {
    await bioStar(
      ctx,
      "DELETE",
      `/api/users/${encodeURIComponent(vendor_user_id)}`
    );
  }

  async assignAccessGroup(
    ctx: AdapterContext,
    vendor_user_id: string,
    group: AccessGroup
  ): Promise<void> {
    await bioStar(
      ctx,
      "POST",
      `/api/users/${encodeURIComponent(vendor_user_id)}/access_groups`,
      { access_group_id: group.group_id }
    );
  }

  async removeAccessGroup(
    ctx: AdapterContext,
    vendor_user_id: string,
    group_id: string
  ): Promise<void> {
    await bioStar(
      ctx,
      "DELETE",
      `/api/users/${encodeURIComponent(vendor_user_id)}/access_groups/${encodeURIComponent(group_id)}`
    );
  }

  async pullAccessLogs(
    ctx: AdapterContext,
    since: Date
  ): Promise<VendorAccessLog[]> {
    interface SupremaEvent {
      id?: string;
      user_id?: string;
      event_type_id?: number;
      datetime?: string;
    }
    const res = await bioStar<{ rows?: SupremaEvent[] }>(
      ctx,
      "GET",
      `/api/events/search?from=${encodeURIComponent(since.toISOString())}`
    );
    return (res.rows ?? []).map((e) => ({
      vendor_event_id: e.id ?? `${e.datetime}-${e.user_id}`,
      vendor_user_id: e.user_id ?? "",
      event_type: mapSupremaEvent(e.event_type_id),
      occurred_at: e.datetime ?? new Date().toISOString(),
      raw: e as unknown as Record<string, unknown>,
    }));
  }

  async openDoor(ctx: AdapterContext): Promise<{ opened_at: string }> {
    if (!ctx.device.device_identifier) {
      throw new Error("Suprema: device.device_identifier (door id) required");
    }
    await bioStar(
      ctx,
      "POST",
      `/api/doors/${encodeURIComponent(ctx.device.device_identifier)}/open`
    );
    return { opened_at: new Date().toISOString() };
  }

  async ping(ctx: AdapterContext): Promise<{ ok: boolean; firmware?: string }> {
    interface SystemInfo {
      version?: string;
      firmware_version?: string;
    }
    const res = await bioStar<SystemInfo>(ctx, "GET", "/api/system/info");
    return { ok: true, firmware: res.firmware_version ?? res.version };
  }
}

function mapSupremaEvent(
  typeId: number | undefined
): "face_match" | "card_swipe" | "door_open" | "denied" {
  // BioStar 2 event_type_id 매핑은 SDK 문서 참조. 임시 휴리스틱:
  if (typeId === undefined) return "face_match";
  if (typeId >= 7000 && typeId < 8000) return "denied";
  if (typeId >= 5000 && typeId < 6000) return "card_swipe";
  if (typeId >= 9000) return "door_open";
  return "face_match";
}
