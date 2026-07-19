// apps/crm/functions/vip.ts
// /vip 경로에만 카톡·문자 링크 미리보기(OG) 태그를 주입하는 Cloudflare Pages Function.
// SPA 본체·라우팅·다른 경로에는 아무 영향 없음. #d= 해시 데이터도 그대로 동작.
export const onRequestGet: PagesFunction = async (context) => {
  const response = await context.next(); // 기존 SPA index.html 그대로 받아서

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const ogTags = `
    <meta property="og:type" content="website" />
    <meta property="og:title" content="🎁 선물이 도착했습니다" />
    <meta property="og:description" content="153복싱짐 쿠폰이 담겨 있어요. 눌러서 확인해 보세요." />
    <meta property="og:image" content="https://153-boxing-os.pages.dev/vip-og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="https://153-boxing-os.pages.dev/vip-og.png" />
  `;

  try {
    return new HTMLRewriter()
      .on("head", {
        element(el) {
          el.append(ogTags, { html: true });
        },
      })
      .transform(response);
  } catch {
    // 주입 실패 시에도 쿠폰 페이지는 정상 서빙
    return response;
  }
};
