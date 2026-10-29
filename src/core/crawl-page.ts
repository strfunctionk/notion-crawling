import { NotionPublicClient } from "./client";
import { plain, render, type RenderCtx } from "./markdown";
import type { CrawledImage, CrawledPage, CrawlOptions } from "./types";

async function checkImage(img: Omit<CrawledImage, "status">): Promise<CrawledImage> {
  try {
    const r = await fetch(img.url, { method: "HEAD", redirect: "follow" });
    return { ...img, status: r.status };
  } catch {
    return { ...img, status: -1 };
  }
}

/**
 * 웹 게시된 노션 페이지 한 장을 수집한다. 하위 페이지는 따라가지 않고 목록(subpages)만 돌려준다.
 * 파일시스템이나 프레임워크에 의존하지 않으므로 그대로 서비스/워커에서 호출할 수 있다.
 */
export async function crawlPage(origin: string, pageId: string, options: CrawlOptions = {}): Promise<CrawledPage> {
  const client = new NotionPublicClient(origin, options.onWarn);
  await client.loadPage(pageId);
  const root = client.blocks.get(pageId);
  if (!root) throw new Error(`페이지를 받지 못했습니다 (비공개이거나 게시되지 않음): ${pageId}`);

  const ctx: RenderCtx = { client, stats: {}, images: [], subpages: [], databases: [] };
  const title = plain(root.properties?.title);
  let markdown = `# ${title}\n\n`;
  for (const c of root.content ?? []) markdown += await render(ctx, c);

  return {
    id: pageId,
    title,
    markdown,
    stats: ctx.stats,
    images: await Promise.all(ctx.images.map(checkImage)),
    subpages: ctx.subpages,
    databases: ctx.databases,
    blockCount: client.blocks.size,
    blocks: Object.fromEntries(client.blocks),
    fetchedAt: new Date(),
  };
}
