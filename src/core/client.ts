import type { RawBlock } from "./types";

// 비공식 내부 API(/api/v3) 클라이언트. 응답 형식이 바뀌면 이 파일이 깨진다.

type Json = any;

const MAX_CHUNKS = 100;

export class NotionPublicClient {
  readonly blocks = new Map<string, RawBlock>();
  readonly collections = new Map<string, Json>();
  spaceId = "";

  constructor(
    readonly origin: string,
    private readonly onWarn: (message: string) => void = () => {},
  ) {}

  async post(path: string, body: Json): Promise<Json> {
    const res = await fetch(`${this.origin}/api/v3/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  private merge(recordMap: Json) {
    for (const [id, r] of Object.entries<Json>(recordMap?.block ?? {})) {
      const v = r.value?.value ?? r.value;
      if (v) {
        this.blocks.set(id, v);
        if (r.spaceId && !this.spaceId) this.spaceId = r.spaceId;
      }
    }
    for (const [id, r] of Object.entries<Json>(recordMap?.collection ?? {})) {
      const v = r.value?.value ?? r.value;
      if (v) this.collections.set(id, v);
    }
  }

  async loadPage(pageId: string) {
    let cursor: Json = { stack: [] };
    for (let n = 0; n < MAX_CHUNKS; n++) {
      const res = await this.post("loadCachedPageChunkV2", {
        page: { id: pageId },
        limit: 100,
        cursor,
        chunkNumber: n,
        verticalColumns: false,
      });
      this.merge(res.recordMap);
      const next = res.cursors?.[0] ?? res.cursor;
      if (!next?.stack?.length) break;
      // 이미 받은 위치만 돌려주는 경우를 막기 위해 직전과 같은 커서면 중단한다.
      if (JSON.stringify(next) === JSON.stringify(cursor)) break;
      cursor = next;
    }
    await this.fillMissing(pageId);
  }

  // 페이지 트리를 따라가며 응답에 빠진 자식 블록을 syncRecordValuesMain 으로 채운다.
  private async fillMissing(rootId: string) {
    for (let round = 0; round < 20; round++) {
      const missing = new Set<string>();
      const walk = (id: string, isRoot: boolean) => {
        const b = this.blocks.get(id);
        if (!b) return void missing.add(id);
        if (!isRoot && (b.type === "page" || b.type === "collection_view_page")) return;
        for (const c of b.content ?? []) walk(c, false);
      };
      walk(rootId, true);
      if (!missing.size) return;
      const ids = [...missing];
      for (let i = 0; i < ids.length; i += 50) {
        const res = await this.post("syncRecordValuesMain", {
          requests: ids.slice(i, i + 50).map((id) => ({
            pointer: { table: "block", id, spaceId: this.spaceId },
            version: -1,
          })),
        });
        this.merge(res.recordMap);
      }
      if (ids.every((id) => !this.blocks.has(id))) {
        this.onWarn(`받지 못한 블록 ${ids.length}개 (비공개이거나 삭제됨)`);
        return;
      }
    }
  }

  async queryCollection(block: RawBlock) {
    const collectionId = block.collection_id ?? block.format?.collection_pointer?.id;
    const viewId = block.view_ids?.[0];
    if (!collectionId || !viewId) return { rows: [] as string[], total: 0 };
    const res = await this.post("queryCollection", {
      source: { type: "collection", id: collectionId, spaceId: this.spaceId },
      collectionView: { id: viewId, spaceId: this.spaceId },
      loader: {
        reducers: { collection_group_results: { type: "results", limit: 1000 } },
        type: "reducer",
        searchQuery: "",
        userTimeZone: "Asia/Seoul",
      },
    });
    this.merge(res.recordMap);
    const r = res.result?.reducerResults?.collection_group_results;
    const blockIds = (r?.blockIds ?? []) as string[];
    return { rows: blockIds, total: (r?.total ?? res.result?.total ?? blockIds.length) as number };
  }

  /** attachment: 주소를 내려받을 수 있는 서명 URL 로 바꾼다. 실패하면 원본을 돌려준다 */
  async signedFileUrl(block: RawBlock, src: string): Promise<string> {
    try {
      const res = await this.post("getSignedFileUrls", {
        urls: [{ url: src, permissionRecord: { table: "block", id: block.id }, useS3Url: true }],
      });
      return res.signedUrls?.[0] ?? src;
    } catch {
      return src;
    }
  }
}
