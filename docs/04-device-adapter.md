# 04. 하드웨어 추상화 (Device Adapter)

> Phase 1 산출물 #6 — 단말기 추상화 인터페이스 + 구현체 설계
> 작성일: 2026-04-28

---

## 1. 추상화 목표

CLAUDE.md L227-238 의 핵심: "**얼굴인식 엔진은 직접 만들지 않는다. 얼굴인식은 단말기가 처리한다.**"

CRM 은 다음만 관리:
- `member_id`, `device_user_id`, `face_registered`, 동의, sync status, access_logs

벤더가 바뀌어도 CRM 본체는 무수정. 어댑터만 교체.

지원 예정:
- **Phase 7**: `MockDeviceAdapter` (모든 메서드 in-memory + DB 시뮬레이션)
- **Phase 8 이후**: `SupremaAdapter` (BioStar 2 / X-Station / FaceStation 시리즈)
- **추후 확장**: `ZktecoAdapter`, `HikvisionAdapter`

---

## 2. 인터페이스 정의

`packages/device-adapters/src/interface.ts`

```typescript
import type { Member, AccessDevice } from "@153/shared";

export interface DeviceUser {
  vendor_user_id: string;
  face_registered: boolean;
  qr_enabled: boolean;
  card_enabled: boolean;
}

export interface AccessGroup {
  group_id: string;
  name: string;
}

export interface VendorAccessLog {
  vendor_event_id: string;
  vendor_user_id: string;
  event_type: "face_match" | "card_swipe" | "door_open" | "denied";
  occurred_at: string;
  raw: Record<string, unknown>;
}

export interface AdapterContext {
  device: AccessDevice;
  device_api_key: string;
  base_url: string;
  /** request id for tracing */
  request_id?: string;
}

/** 모든 메서드는 throw 하면 sync_job=failed 로 기록됨. 반환값은 idempotent 하게 다뤄야 함. */
export interface AccessDeviceAdapter {
  /** 단말기에 회원 사용자 생성 (얼굴 등록 슬롯 포함). returns vendor_user_id */
  createUser(ctx: AdapterContext, member: Member): Promise<string>;

  /** 단말기 사용자 정보 갱신 (이름·기간 등). idempotent 필수. */
  updateUser(ctx: AdapterContext, member: Member, vendor_user_id: string): Promise<void>;

  /** 단말기에서 사용자 비활성화 (기록은 남김). 재활성 가능. */
  disableUser(ctx: AdapterContext, vendor_user_id: string): Promise<void>;

  /** 단말기에서 사용자 영구 삭제 (얼굴 템플릿 포함). 동의 철회 시 호출. */
  deleteUser(ctx: AdapterContext, vendor_user_id: string): Promise<void>;

  /** 출입 그룹 부여 — 시간대·문 제한 적용 */
  assignAccessGroup(ctx: AdapterContext, vendor_user_id: string, group: AccessGroup): Promise<void>;

  removeAccessGroup(ctx: AdapterContext, vendor_user_id: string, group_id: string): Promise<void>;

  /** 단말기 자체 로그를 since 부터 가져옴. webhook 이 없는 벤더용 폴백. */
  pullAccessLogs(ctx: AdapterContext, since: Date): Promise<VendorAccessLog[]>;

  /** 관리자 원격 오픈 */
  openDoor(ctx: AdapterContext): Promise<{ opened_at: string }>;

  /** 헬스체크 — last_seen_at 갱신용 */
  ping(ctx: AdapterContext): Promise<{ ok: boolean; firmware?: string }>;
}
```

### 설계 결정 근거

| 결정 | 이유 |
|---|---|
| `createUser` 가 `vendor_user_id` 반환 | 어댑터마다 ID 생성 방식이 다름 (Suprema 는 자동, ZKTeco 는 사전 지정) |
| `disableUser` vs `deleteUser` 분리 | 일시 정지(미납·휴회) 와 영구 삭제(탈퇴·동의 철회) 구분 |
| `pullAccessLogs(since)` 폴백 메서드 | 일부 벤더가 webhook 미지원 → cron 으로 보완 |
| context 객체로 device + api_key 전달 | 같은 벤더라도 지점마다 base_url·api_key 다름 |
| 모든 메서드 async + throw on failure | sync_job 큐 처리에서 try/catch 한 곳으로 일원화 |

---

## 3. Factory

`packages/device-adapters/src/factory.ts`

```typescript
import type { AccessDeviceAdapter } from "./interface";
import { MockDeviceAdapter } from "./adapters/mock";
import { SupremaAdapter } from "./adapters/suprema";
import { ZktecoAdapter } from "./adapters/zkteco";
import { HikvisionAdapter } from "./adapters/hikvision";

export function getAdapter(vendor: string): AccessDeviceAdapter {
  switch (vendor) {
    case "mock":      return new MockDeviceAdapter();
    case "suprema":   return new SupremaAdapter();
    case "zkteco":    return new ZktecoAdapter();
    case "hikvision": return new HikvisionAdapter();
    default:
      throw new Error(`Unsupported vendor: ${vendor}`);
  }
}
```

Workers API 의 `syncQueue` 가 `device_sync_jobs` 처리 시:
```typescript
const device = await db.access_devices.byId(job.device_id);
const adapter = getAdapter(device.vendor);
await adapter[job.job_type](ctx, ...);  // 동적 디스패치
```

---

## 4. MockDeviceAdapter (Phase 7 구현)

```typescript
export class MockDeviceAdapter implements AccessDeviceAdapter {
  private users = new Map<string, DeviceUser>();
  private logs: VendorAccessLog[] = [];

  async createUser(ctx, member) {
    const id = `mock_${member.id}`;
    this.users.set(id, { vendor_user_id: id, face_registered: false, qr_enabled: true, card_enabled: false });
    return id;
  }
  async updateUser() { /* no-op */ }
  async disableUser(ctx, id) { this.users.delete(id); }
  async deleteUser(ctx, id) { this.users.delete(id); }
  async assignAccessGroup() {}
  async removeAccessGroup() {}
  async pullAccessLogs(ctx, since) {
    return this.logs.filter(l => new Date(l.occurred_at) >= since);
  }
  async openDoor() { return { opened_at: new Date().toISOString() }; }
  async ping() { return { ok: true, firmware: "mock-1.0" }; }

  /** 테스트용 helper */
  __injectFaceMatch(vendor_user_id: string) {
    this.logs.push({
      vendor_event_id: crypto.randomUUID(),
      vendor_user_id,
      event_type: "face_match",
      occurred_at: new Date().toISOString(),
      raw: {}
    });
  }
}
```

테스트 시나리오 (CLAUDE.md L302-313):
1. `createUser` 후 `__injectFaceMatch` → webhook 시뮬레이션 → access_logs 적재
2. 이용권 만료 시뮬 → `disableUser` 호출 확인
3. 동의 철회 → `deleteUser` 호출 확인

---

## 5. SupremaAdapter (Phase 8 이후 — 계약 후 구현)

**전제:** Suprema BioStar 2 API 사용. 실제 API 명세는 계약 후 확정.

```typescript
export class SupremaAdapter implements AccessDeviceAdapter {
  async createUser(ctx, member) {
    const res = await fetch(`${ctx.base_url}/api/users`, {
      method: "POST",
      headers: this.authHeaders(ctx),
      body: JSON.stringify({
        UserID: member.id,
        Name: member.name,
        Phone: member.phone,
        // 얼굴 템플릿은 별도 엔드포인트
      })
    });
    if (!res.ok) throw new Error(`Suprema createUser failed: ${res.status}`);
    const data = await res.json();
    return data.UserID;
  }
  // ...
  private authHeaders(ctx: AdapterContext): HeadersInit {
    return {
      "Content-Type": "application/json",
      "BS-Session-ID": ctx.device_api_key  // 또는 별도 세션 발급
    };
  }
}
```

**계약 전 작업 가능 항목:**
- 인터페이스 메서드 시그니처 결정 (위 §2)
- Mock 으로 통합 테스트
- 데이터 모델 정합 (회원 → vendor 사용자 변환 함수)

**계약 후 작업:**
- 실제 엔드포인트 / 헤더 / 인증 흐름 채워넣기
- 얼굴 템플릿 등록 플로우 (보통 단말기 자체 등록 모드 + CRM 매핑만)

---

## 6. 어댑터 호출 패턴 (Workers 측)

`workers/api/src/services/syncQueue.ts`

```typescript
export async function processNextBatch(env: Env, limit = 50) {
  const jobs = await env.DB.fetchPendingSyncJobs(limit);

  for (const job of jobs) {
    const device = await env.DB.getDevice(job.device_id);
    const adapter = getAdapter(device.vendor);
    const ctx: AdapterContext = {
      device,
      device_api_key: await decryptApiKey(device.api_key_hash, env.DEVICE_KMS_KEY),
      base_url: device.api_endpoint,
      request_id: crypto.randomUUID()
    };

    try {
      await dispatchJob(adapter, ctx, job);
      await env.DB.markJobSuccess(job.id);
    } catch (err) {
      await env.DB.markJobFailed(job.id, err.message);
      if (job.retry_count + 1 >= 5) {
        await env.DB.setDeviceError(device.id, err.message);
      }
    }
  }
}

async function dispatchJob(a: AccessDeviceAdapter, ctx: AdapterContext, job: SyncJob) {
  switch (job.job_type) {
    case "create_user":  return a.createUser(ctx, job.member);
    case "update_user":  return a.updateUser(ctx, job.member, job.vendor_user_id);
    case "disable_user": return a.disableUser(ctx, job.vendor_user_id);
    case "delete_user":  return a.deleteUser(ctx, job.vendor_user_id);
    case "sync_access_group": return a.assignAccessGroup(ctx, job.vendor_user_id, job.group);
    case "pull_logs":    return a.pullAccessLogs(ctx, job.since);
  }
}
```

---

## 7. 보안 / 키 관리

- `device_api_key` 평문 절대 미저장. `bcrypt(api_key)` 를 `access_devices.api_key_hash` 에 저장 → device 측 검증 시 비교.
- Workers → 단말기로 호출할 때 필요한 키는 별도로 KMS (Cloudflare Secrets Store 또는 자체 envelope encryption) 사용 — 평문 DB 저장 금지.
- 단말기 webhook 의 HMAC secret 도 같은 원칙. 발급 시 한 번만 평문 노출, 이후 hash 저장.

---

## 8. 향후 확장 포인트

| 시나리오 | 어댑터 변경 | 인터페이스 변경 |
|---|---|---|
| Suprema → ZKTeco 교체 | 새 adapter 클래스 | ❌ |
| 얼굴인식 + 지문 동시 단말기 | 같은 adapter, credential 추가 | `createUser` 옵션 인자 |
| 다중 도어 단말기 | adapter 가 door_id 지원 | `openDoor(ctx, door_id?)` 옵션 추가 |
| 모바일 NFC | 별도 adapter (앱 측 백엔드와 통신) | ❌ (qr 와 동일 패턴) |

인터페이스 변경 시: 모든 기존 adapter 가 컴파일 에러 → 일괄 업데이트 강제. 이게 추상화의 안전장치.

---

**다음 문서:** [05-roadmap.md](./05-roadmap.md) — Phase 2~8 세분화 + 마일스톤
