import type {
  AccessDeviceAdapter,
  AccessDeviceMember,
  AccessGroup,
  AdapterContext,
  VendorAccessLog,
} from "../interface";

/**
 * BrojAdapter — 브로제이(Broj) 안면인식 출입 CRM 어댑터 (자리·스텁).
 *
 * 선릉점 출입은 브로제이 안면인식 단말기가 담당한다. 브로제이가 오픈 API 를
 * 제공하기로 함 — 명세 수령 후 아래 메서드 본문만 채우면 라이브.
 *   · createUser     : 회원 + 얼굴 등록(출입 사용자 생성) → vendor_user_id 반환
 *   · updateUser     : 회원 정보/얼굴 갱신
 *   · disableUser    : 만료·미납·홀딩·환불 시 출입 차단
 *   · deleteUser     : 탈퇴/동의철회 시 삭제
 *   · assignAccessGroup / removeAccessGroup : 지점·시간대 출입권한
 *   · pullAccessLogs : 출입 로그 수집(→ access_logs)
 *   · openDoor       : 관리자 원격 오픈
 * 인증: API Key(+서명) — IP 화이트리스트 불필요(Cloudflare Workers 호환).
 *
 * 명세 수령 전 호출 시 명확히 throw → 운영에서 가짜 출입 허용 방지.
 * (sync_job=failed 로 기록되어 관리자에게 표시됨)
 */
const NIY = "BROJ_NOT_CONFIGURED";
function niy(method: string): never {
  throw new Error(`${NIY}: 브로제이 ${method} — 오픈 API 명세 수령 후 구현 예정`);
}

export class BrojAdapter implements AccessDeviceAdapter {
  async createUser(_ctx: AdapterContext, _member: AccessDeviceMember): Promise<string> {
    return niy("createUser");
  }
  async updateUser(
    _ctx: AdapterContext,
    _member: AccessDeviceMember,
    _vendor_user_id: string
  ): Promise<void> {
    niy("updateUser");
  }
  async disableUser(_ctx: AdapterContext, _vendor_user_id: string): Promise<void> {
    niy("disableUser");
  }
  async deleteUser(_ctx: AdapterContext, _vendor_user_id: string): Promise<void> {
    niy("deleteUser");
  }
  async assignAccessGroup(
    _ctx: AdapterContext,
    _vendor_user_id: string,
    _group: AccessGroup
  ): Promise<void> {
    niy("assignAccessGroup");
  }
  async removeAccessGroup(
    _ctx: AdapterContext,
    _vendor_user_id: string,
    _group_id: string
  ): Promise<void> {
    niy("removeAccessGroup");
  }
  async pullAccessLogs(_ctx: AdapterContext, _since: Date): Promise<VendorAccessLog[]> {
    return niy("pullAccessLogs");
  }
  async openDoor(_ctx: AdapterContext): Promise<{ opened_at: string }> {
    return niy("openDoor");
  }
  async ping(_ctx: AdapterContext): Promise<{ ok: boolean; firmware?: string }> {
    return niy("ping");
  }
}
