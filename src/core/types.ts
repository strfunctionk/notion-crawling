// 크롤러가 바깥(도메인)에 돌려주는 결과 모델.
// 비공식 내부 API 의 응답 모양(properties, recordMap 등)은 이 파일 밖으로 새지 않게 한다.

/** 노션 내부 API 의 블록 원본. 디버깅과 재가공용으로만 남긴다 */
export type RawBlock = Record<string, any>;

export interface CrawledImage {
  blockId: string;
  /** 노션이 가진 원본 주소 (attachment:... 또는 외부 URL) */
  source: string;
  caption: string;
  /** 바로 열 수 있는 주소. 노션 업로드 파일은 프록시 URL 이라 만료될 수 있다 */
  url: string;
  /** 접근 확인 결과(HTTP 코드). 네트워크 오류는 -1 */
  status: number;
}

export interface CrawledSubpage {
  id: string;
  title: string;
}

export interface CrawledDatabase {
  blockId: string;
  /** 노션이 알려준 전체 행 수 */
  total: number;
  /** 실제로 받은 행 수. total 보다 작으면 일부만 수집된 것 */
  got: number;
}

export interface CrawledPage {
  /** 하이픈 포함 UUID */
  id: string;
  title: string;
  markdown: string;
  /** 블록 타입별 개수 */
  stats: Record<string, number>;
  images: CrawledImage[];
  subpages: CrawledSubpage[];
  databases: CrawledDatabase[];
  blockCount: number;
  blocks: Record<string, RawBlock>;
  fetchedAt: Date;
}

export interface CrawlOptions {
  /** 진단 메시지를 받을 곳. 없으면 버린다 */
  onWarn?: (message: string) => void;
}
