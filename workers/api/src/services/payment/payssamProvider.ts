import type {
  PaymentProvider,
  PaymentContext,
  CreateBillInput,
  CreateBillResult,
  CancelInput,
  CancelResult,
  ParsedCallback,
} from "./types";

/**
 * PayssamProvider — 결제선생(페이민트) 결제 어댑터 (자리·스텁).
 *
 * 파트너 제휴 계약 + Live API Key 수령 후 본문을 채운다.
 *   · SANDBOX: https://sandbox.paymint.co.kr/partner  (검수용)
 *   · 인증: API Key + 요청별 hash 서명 (IP 화이트리스트 불필요 → Workers 호환)
 *   · 청구서 발송(POST /bill) → 회원 카카오 알림톡 결제
 *   · 결제완료/취소는 callbackURL 로 수신 → parseCallback
 *   · 명세: https://developers.payssam.kr/
 *
 * 키/명세 수령 전까지 호출 시 명확히 throw (운영에서 가짜 성공 방지).
 */
const NIY = "PAYSSAM_NOT_CONFIGURED";
function niy(method: string): never {
  throw new Error(`${NIY}: 결제선생 ${method} — Live API Key/명세 수령 후 구현 예정`);
}

export class PayssamProvider implements PaymentProvider {
  readonly name = "payssam";

  async createBill(_ctx: PaymentContext, _input: CreateBillInput): Promise<CreateBillResult> {
    return niy("createBill");
  }

  async cancel(_ctx: PaymentContext, _input: CancelInput): Promise<CancelResult> {
    return niy("cancel");
  }

  async verifyCallback(
    _ctx: PaymentContext,
    _headers: Record<string, string>,
    _rawBody: string
  ): Promise<boolean> {
    return niy("verifyCallback");
  }

  parseCallback(_rawBody: string, _headers: Record<string, string>): ParsedCallback {
    return niy("parseCallback");
  }
}
