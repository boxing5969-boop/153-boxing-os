// /vip — 카톡·문자 공유용 쿠폰 랜딩 페이지 (OG 미리보기 포함)
// Cloudflare Pages Function: apps/crm/functions/vip.ts → https://<도메인>/vip
// OG 이미지는 /vip-og.png (apps/crm/public/vip-og.png, 1200x630)

interface RequestContext {
  request: Request;
}

const renderHtml = (origin: string): string => `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎁 153복싱짐 선릉점 · 글러브+붕대 50% 할인쿠폰</title>
<meta property="og:type" content="website">
<meta property="og:title" content="🎁 선물이 도착했습니다">
<meta property="og:description" content="153복싱짐 선릉점 · 글러브+붕대 50% 할인쿠폰 (8/31까지)">
<meta property="og:image" content="${origin}/vip-og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${origin}/vip">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${origin}/vip-og.png">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=Archivo+Black&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0c0d0f;
    --charcoal:#17181c;
    --charcoal2:#1e2026;
    --mint:#3ee6c4;
    --gold:#e6c15a;
    --text:#f2f3f5;
    --sub:#9aa0a8;
    --line:rgba(255,255,255,.08);
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{
    background:var(--bg);
    min-height:100vh;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:32px 16px;
    font-family:'Noto Sans KR',sans-serif;
    background-image:
      radial-gradient(ellipse 60% 40% at 50% 0%, rgba(62,230,196,.06), transparent 70%),
      repeating-linear-gradient(135deg, transparent 0 14px, rgba(255,255,255,.012) 14px 15px);
  }
  .coupon{
    width:380px;
    max-width:100%;
    background:linear-gradient(160deg, var(--charcoal2) 0%, var(--charcoal) 55%, #121317 100%);
    border:1px solid var(--line);
    border-radius:20px;
    overflow:hidden;
    position:relative;
    box-shadow:0 24px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(62,230,196,.06);
  }
  /* 상단 브랜드 바 */
  .brandbar{
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:18px 22px 14px;
    border-bottom:1px solid var(--line);
  }
  .logo{
    font-family:'Archivo Black',sans-serif;
    font-size:19px;
    letter-spacing:.5px;
    color:var(--text);
  }
  .logo em{font-style:normal;color:var(--mint);}
  .branch{
    font-size:12px;
    font-weight:700;
    color:var(--mint);
    border:1px solid rgba(62,230,196,.4);
    padding:4px 10px;
    border-radius:999px;
    letter-spacing:.06em;
  }
  /* 본문 */
  .body{
    padding:26px 22px 22px;
    text-align:center;
    position:relative;
  }
  .item{
    font-size:15px;
    font-weight:700;
    color:var(--text);
    letter-spacing:.14em;
    margin-bottom:6px;
  }
  .item span{color:var(--sub);font-weight:500;letter-spacing:.1em;}
  .pct{
    font-family:'Archivo Black','Noto Sans KR',sans-serif;
    font-size:96px;
    line-height:1;
    color:var(--mint);
    letter-spacing:-2px;
    text-shadow:0 0 34px rgba(62,230,196,.28);
  }
  .pct small{
    font-size:34px;
    letter-spacing:0;
    vertical-align:18px;
  }
  .off{
    display:inline-block;
    margin-top:8px;
    font-size:13px;
    font-weight:900;
    letter-spacing:.5em;
    text-indent:.5em;
    color:var(--text);
    padding:6px 14px;
    border-top:1px solid var(--line);
    border-bottom:1px solid var(--line);
  }
  .desc{
    margin-top:16px;
    font-size:13px;
    color:var(--sub);
    line-height:1.7;
  }
  .desc b{color:var(--text);font-weight:700;}
  /* 절취선 */
  .tear{
    position:relative;
    height:0;
    border-top:2px dashed rgba(255,255,255,.16);
    margin:0 14px;
  }
  .tear::before,.tear::after{
    content:'';
    position:absolute;
    top:-13px;
    width:26px;height:26px;
    border-radius:50%;
    background:var(--bg);
    border:1px solid var(--line);
  }
  .tear::before{left:-28px;}
  .tear::after{right:-28px;}
  /* 하단 */
  .foot{
    padding:18px 22px 22px;
  }
  .row{
    display:flex;
    justify-content:space-between;
    align-items:baseline;
    font-size:12.5px;
    padding:5px 0;
  }
  .row .k{color:var(--sub);font-weight:500;}
  .row .v{color:var(--text);font-weight:700;letter-spacing:.02em;}
  .row .v.gold{color:var(--gold);}
  .serial{
    margin-top:14px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    background:rgba(0,0,0,.35);
    border:1px solid var(--line);
    border-radius:10px;
    padding:10px 14px;
  }
  .serial .no{
    font-family:'Archivo Black',monospace;
    font-size:14px;
    letter-spacing:.22em;
    color:var(--text);
  }
  .serial .tag{
    font-size:10.5px;
    font-weight:700;
    color:var(--bg);
    background:var(--mint);
    border-radius:5px;
    padding:3px 8px;
    letter-spacing:.05em;
  }
  .notice{
    margin-top:12px;
    font-size:10.5px;
    color:#6b7077;
    line-height:1.75;
  }
</style>
</head>
<body>
  <div class="coupon">
    <div class="brandbar">
      <div class="logo">15<em>3</em> BOXING</div>
      <div class="branch">선릉점 전용</div>
    </div>

    <div class="body">
      <div class="item">글러브 <span>+</span> 붕대 세트</div>
      <div class="pct">50<small>%</small></div>
      <div class="off">할인쿠폰</div>
      <div class="desc">
        선릉점 카운터에서 이 쿠폰을 보여주시면<br>
        <b>글러브·붕대 구매 시 50% 할인</b>이 적용됩니다.
      </div>
    </div>

    <div class="tear"></div>

    <div class="foot">
      <div class="row"><span class="k">사용 지점</span><span class="v">153복싱짐 선릉점 (선릉역 도보 2분)</span></div>
      <div class="row"><span class="k">유효기간</span><span class="v gold">2026. 07. 20 ~ 2026. 08. 31</span></div>
      <div class="row"><span class="k">사용 조건</span><span class="v">1인 1회 · 현장 결제 시 제시</span></div>

      <div class="serial">
        <span class="no">153-SL-5050</span>
        <span class="tag">COUPON</span>
      </div>

      <div class="notice">
        · 타 할인·프로모션과 중복 적용 불가 &nbsp;· 재고 소진 시 조기 종료될 수 있습니다<br>
        · 문의: 153복싱짐 선릉점 카운터
      </div>
    </div>
  </div>
</body>
</html>
`;

export const onRequestGet = ({ request }: RequestContext): Response => {
  const origin = new URL(request.url).origin;
  return new Response(renderHtml(origin), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
