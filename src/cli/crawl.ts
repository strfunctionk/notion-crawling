import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crawlPage, parsePublicUrl, type CrawledPage } from "../core";

// 사용법: pnpm crawl <노션 게시 URL> [--depth=2]
// 이 파일은 로컬 검증용 실행기다. 수집 로직은 ../core 에 있고, 여기서는 파일 저장과 출력만 한다.

// 페이지마다 폴더 하나(제목 + ID 뒤 8자리)를 만들고, 하위 페이지는 그 안의 폴더로 넣는다.
//   out/<루트>/page.md, page.json
//   out/<루트>/<하위 A>/page.md ...
function dirName(page: CrawledPage) {
  const safeTitle = page.title.replace(/[\/:*?"<>|]/g, "").trim().slice(0, 60) || "untitled";
  return `${safeTitle}-${page.id.replace(/-/g, "").slice(-8)}`;
}

async function save(dir: string, page: CrawledPage, childDirs: Map<string, string>) {
  // 수집한 하위 페이지로 가는 링크는 page:ID 에서 상대 경로로 바꾼다
  let md = page.markdown;
  for (const [id, name] of childDirs) md = md.replaceAll(`(page:${id})`, `(<${name}/page.md>)`);
  await writeFile(join(dir, "page.md"), md);
  await writeFile(join(dir, "page.json"), JSON.stringify(page, null, 2));
}

function report(page: CrawledPage) {
  console.log(`✔ ${page.title || page.id}  blocks=${page.blockCount}  md=${page.markdown.length}자`);
  console.log("  타입:", JSON.stringify(page.stats));
  for (const d of page.databases) console.log(`  DB ${d.blockId}: ${d.got}/${d.total}행`);
  for (const i of page.images) console.log(`  이미지 ${i.status} ${i.caption || "(캡션 없음)"}`);
}

/** 수집에 성공하면 이 페이지의 폴더 이름을 돌려준다 */
async function crawlTree(
  origin: string,
  pageId: string,
  parentDir: string,
  depth: number,
  seen: Set<string>,
): Promise<string | null> {
  if (seen.has(pageId)) return null;
  seen.add(pageId);
  let page: CrawledPage;
  try {
    page = await crawlPage(origin, pageId, { onWarn: (m) => console.warn(`  ${m}`) });
  } catch (e) {
    console.warn(String((e as Error).message));
    return null;
  }
  const name = dirName(page);
  const dir = join(parentDir, name);
  await mkdir(dir, { recursive: true });
  report(page);

  const childDirs = new Map<string, string>();
  if (depth > 0) {
    for (const sp of page.subpages) {
      const child = await crawlTree(origin, sp.id, dir, depth - 1, seen);
      if (child) childDirs.set(sp.id, child);
    }
  } else if (page.subpages.length) {
    console.log(`  하위 페이지 ${page.subpages.length}개는 depth 제한으로 건너뜀`);
  }
  await save(dir, page, childDirs);
  return name;
}

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
if (!url) {
  console.error("사용법: pnpm crawl <노션 게시 URL> [--depth=2]");
  process.exit(1);
}
const depth = Number(args.find((a) => a.startsWith("--depth="))?.split("=")[1] ?? 2);
const { origin, id } = parsePublicUrl(url);
const outDir = join(process.cwd(), "out");
await mkdir(outDir, { recursive: true });
await crawlTree(origin, id, outDir, depth, new Set());
