import type { NotionPublicClient } from "./client";
import type { CrawledDatabase, CrawledImage, CrawledSubpage, RawBlock } from "./types";

type Json = any;

export function rich(parts: Json[] | undefined): string {
  if (!parts) return "";
  return parts
    .map(([text, fmts]: [string, Json[]?]) => {
      let s = text;
      for (const [f, arg] of fmts ?? []) {
        if (f === "c") s = `\`${s}\``;
        else if (f === "b") s = `**${s}**`;
        else if (f === "i") s = `*${s}*`;
        else if (f === "s") s = `~~${s}~~`;
        else if (f === "a") s = `[${s}](${arg})`;
        else if (f === "e") s = `$${arg}$`;
        else if (f === "d") s = arg?.start_date ? `${arg.start_date}${arg.end_date ? ` ~ ${arg.end_date}` : ""}` : s;
      }
      return s;
    })
    .join("");
}

export const plain = (parts: Json[] | undefined) => (parts ?? []).map((p: Json) => p[0]).join("");

const quote = (text: string, p: string) =>
  text
    .split("\n")
    .map((l) => `${p}> ${l}`.trimEnd())
    .join("\n");

/** 렌더링하면서 모아 두는 부산물. 이미지 접근 확인은 호출한 쪽이 한다 */
export interface RenderCtx {
  client: NotionPublicClient;
  stats: Record<string, number>;
  images: Omit<CrawledImage, "status">[];
  subpages: CrawledSubpage[];
  databases: CrawledDatabase[];
}

function imageUrl(ctx: RenderCtx, b: RawBlock): string {
  const src = b.properties?.source?.[0]?.[0] ?? b.format?.display_source ?? "";
  if (!src) return "";
  // 노션에 올린 파일은 S3 서명 URL 이라 만료된다. 노션 프록시 URL 로 바꿔 접근한다.
  if (src.startsWith("attachment:") || src.includes("secure.notion-static.com") || src.includes("prod-files-secure")) {
    return `${ctx.client.origin}/image/${encodeURIComponent(src)}?table=block&id=${b.id}&spaceId=${ctx.client.spaceId}&width=1000`;
  }
  return src;
}

export async function render(ctx: RenderCtx, id: string, indent = ""): Promise<string> {
  const b = ctx.client.blocks.get(id);
  if (!b) return "";
  ctx.stats[b.type] = (ctx.stats[b.type] ?? 0) + 1;
  const title = rich(b.properties?.title);
  const kids = async (ind: string) => {
    let out = "";
    for (const c of b.content ?? []) out += await render(ctx, c, ind);
    return out;
  };
  const p = indent;

  switch (b.type) {
    case "header":
      return `${p}# ${title}\n\n`;
    case "sub_header":
      return `${p}## ${title}\n\n`;
    case "sub_sub_header":
      return `${p}### ${title}\n\n`;
    case "header_4":
      return `${p}#### ${title}\n\n`;
    case "text":
      return `${p}${title}\n\n${await kids(p)}`;
    case "bulleted_list":
      return `${p}- ${title}\n${await kids(p + "  ")}`;
    case "numbered_list":
      return `${p}1. ${title}\n${await kids(p + "   ")}`;
    case "to_do": {
      const checked = b.properties?.checked?.[0]?.[0] === "Yes";
      return `${p}- [${checked ? "x" : " "}] ${title}\n${await kids(p + "  ")}`;
    }
    case "toggle":
      return `${p}<details><summary>${title}</summary>\n\n${await kids(p)}\n${p}</details>\n\n`;
    case "quote": {
      const body = title + (b.content?.length ? `\n\n${(await kids("")).trimEnd()}` : "");
      return `${quote(body, p)}\n\n`;
    }
    case "callout": {
      // callout_version 2 는 본문이 properties 가 아니라 자식 블록에 들어 있다.
      const head = `${b.format?.page_icon ?? ""} ${title}`.trim();
      const body = head + (b.content?.length ? `\n\n${(await kids("")).trimEnd()}` : "");
      return `${quote(body, p)}\n\n`;
    }
    case "divider":
      return `${p}---\n\n`;
    case "code": {
      const lang = plain(b.properties?.language).toLowerCase();
      return `${p}\`\`\`${lang === "plain text" ? "" : lang}\n${plain(b.properties?.title)}\n${p}\`\`\`\n\n`;
    }
    case "equation":
      return `${p}$$\n${plain(b.properties?.title)}\n$$\n\n`;
    case "bookmark":
    case "embed":
    case "video":
    case "audio":
    case "file":
    case "pdf": {
      let url = b.properties?.link?.[0]?.[0] ?? b.properties?.source?.[0]?.[0] ?? "";
      if (url.startsWith("attachment:")) url = await ctx.client.signedFileUrl(b, url);
      const label = plain(b.properties?.title) || url;
      return `${p}[${label}](${url})\n\n`;
    }
    case "image": {
      const url = imageUrl(ctx, b);
      const caption = rich(b.properties?.caption);
      ctx.images.push({ blockId: b.id, source: b.properties?.source?.[0]?.[0] ?? "", caption, url });
      return `${p}![${caption}](${url})\n\n`;
    }
    case "column_list":
    case "column":
      return await kids(p);
    case "table_of_contents":
      return `${p}[목차]\n\n`;
    case "table": {
      const order: string[] = b.format?.table_block_column_order ?? [];
      const rows: string[][] = [];
      for (const rid of b.content ?? []) {
        const row = ctx.client.blocks.get(rid);
        if (row) rows.push(order.map((col) => rich(row.properties?.[col]).replace(/\|/g, "\\|")));
      }
      if (!rows.length) return "";
      const line = (r: string[]) => `${p}| ${r.join(" | ")} |\n`;
      return line(rows[0]) + line(order.map(() => "---")) + rows.slice(1).map(line).join("") + "\n";
    }
    case "page":
      ctx.subpages.push({ id: b.id, title: plain(b.properties?.title) });
      return `${p}[📄 ${plain(b.properties?.title)}](page:${b.id})\n\n`;
    case "collection_view":
    case "collection_view_page":
      return renderDatabase(ctx, b, p);
    default:
      return `${p}<!-- 지원하지 않는 블록: ${b.type} -->\n${await kids(p)}`;
  }
}

async function renderDatabase(ctx: RenderCtx, b: RawBlock, p: string): Promise<string> {
  const collectionId = b.collection_id ?? b.format?.collection_pointer?.id;
  const { rows, total } = await ctx.client.queryCollection(b);
  ctx.databases.push({ blockId: b.id, total, got: rows.length });
  const schema: Record<string, Json> = ctx.client.collections.get(collectionId)?.schema ?? {};
  const cols = Object.entries(schema);
  if (!cols.length) return `${p}<!-- 데이터베이스 스키마 없음 -->\n\n`;
  const head = cols.map(([, s]) => s.name);
  let out = `${p}| ${head.join(" | ")} |\n${p}| ${head.map(() => "---").join(" | ")} |\n`;
  for (const rid of rows) {
    const row = ctx.client.blocks.get(rid);
    if (!row) continue;
    out += `${p}| ${cols.map(([k]) => rich(row.properties?.[k]).replace(/\|/g, "\\|")).join(" | ")} |\n`;
  }
  return `${out}\n`;
}
