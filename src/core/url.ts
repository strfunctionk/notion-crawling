export interface PublicPageRef {
  /** 예: https://xxx.notion.site */
  origin: string;
  /** 하이픈 포함 UUID */
  id: string;
}

export function toUuid(hex: string): string {
  const s = hex.replace(/-/g, "").toLowerCase();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** 웹 게시 URL 에서 origin 과 페이지 ID 를 뽑는다 */
export function parsePublicUrl(raw: string): PublicPageRef {
  const u = new URL(raw);
  const m = u.pathname.match(/([0-9a-f]{32})$/i);
  if (!m) throw new Error(`URL에서 32자리 페이지 ID를 찾지 못했습니다: ${raw}`);
  return { origin: u.origin, id: toUuid(m[1]) };
}
