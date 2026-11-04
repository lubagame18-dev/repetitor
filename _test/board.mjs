/* Проверки доски v54 (якоря, вложения, перемещение, текст, доп. листы) на стенде _test/board.html.
   Запуск: node _test/board.mjs                    (headless; сам поднимает serve.mjs + Chrome через cdp.mjs)
           BOARD_HEADLESS=0 node _test/board.mjs   (видимое окно)
           BOARD_ONLY=C,D,E node _test/board.mjs   (фильтр по id)
   Требуется Chrome/Edge (см. cdp.mjs) и Node 22+ (глобальный WebSocket). npm не нужен.
   Подробнее — _test/README.md. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";
import { startServer } from "./serve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(__dirname, "artifacts");
const B = "window.__board";
const PAGE_KEY = "_pages";      // api-ключ доп. листов в v54
const PAGE_HTML_MAX = 55000;    // лимит html одного листа

/* ---------- фикстуры (без сети): png пишем сами, pdf — минимальный контейнер ---------- */
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 бит, truecolor
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const p = o + 1 + x * 3;
      raw[p] = rgb[0]; raw[p + 1] = rgb[1] + Math.round(40 * x / Math.max(1, w - 1)); raw[p + 2] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
function makeFixtures() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bd-fixtures-"));
  const png1 = makePng(24, 18, [220, 60, 120]);
  const png2 = makePng(20, 26, [60, 140, 220]);
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 600 800]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n", "utf8");
  fs.writeFileSync(path.join(dir, "photo-1.png"), png1);
  fs.writeFileSync(path.join(dir, "photo-2.png"), png2);
  fs.writeFileSync(path.join(dir, "document.pdf"), pdf);
  return {
    dir,
    image1: path.join(dir, "photo-1.png"),
    image2: path.join(dir, "photo-2.png"),
    pdf: path.join(dir, "document.pdf"),
    files: {
      image1: { name: "photo-1.png", type: "image/png", b64: png1.toString("base64") },
      image2: { name: "photo-2.png", type: "image/png", b64: png2.toString("base64") },
      pdf: { name: "document.pdf", type: "application/pdf", b64: pdf.toString("base64") },
    },
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} },
  };
}

/* ---------- низкоуровневые шаги ---------- */
async function fresh(page) {
  await page.eval(`${B}.clearStore(); ${B}.mountBoth(); true`);
  await page.eval(`${B}.mountBothReady()`);
  await page.eval("document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true").catch(() => {});
  await sleep(150);
}
async function remount(page, side) {
  await page.eval(`${B}.remountReady(${JSON.stringify(side)})`);
  await sleep(80);
}
/** искусственный сдвиг макета доски (padding-top листа) + пересчёт layout/якорей */
async function shiftBoard(page, side, px) {
  const ok = await page.eval(`(() => ${B}.shiftLayout(${JSON.stringify(side)}, ${px}))()`);
  if (!ok) throw new Error("не удалось сдвинуть макет «" + side + "» (нет .bd-bg .bd-sheet)");
  await page.eval(`${B}.relayout(${JSON.stringify(side)})`);
}
async function geometry(page, side, selector) {
  return page.eval(`${B}.logicalRect(${JSON.stringify(side)}, ${JSON.stringify(selector)})`);
}
/** нарисовать штрих настоящими событиями мыши CDP; pts — логические координаты листа */
async function drawStroke(page, side, pts) {
  const vp = await page.eval(`(() => { const b = ${B}; const pts = ${JSON.stringify(pts)}; return pts.map(p => b.point(${JSON.stringify(side)}, p[0], p[1])); })()`);
  if (!vp || !vp.length || vp.some(p => !p)) throw new Error("не удалось получить координаты canvas для " + side);
  await page.mouse("mousePressed", vp[0].x, vp[0].y);
  for (let i = 1; i < vp.length; i++) await page.mouse("mouseMoved", vp[i].x, vp[i].y);
  await page.mouse("mouseReleased", vp[vp.length - 1].x, vp[vp.length - 1].y);
  await sleep(180);
}
/** подложить файлы в доску: File в странице + attach(files) (диалог появляется асинхронно) */
async function uploadFiles(page, side, files) {
  const r = await page.eval(`(() => { try { return ${B}.attachFiles(${JSON.stringify(side)}, ${JSON.stringify(files)}); } catch (e) { return "ERR:" + (e && e.message || e); } })()`);
  if (typeof r === "string" && r.startsWith("ERR:")) throw new Error(r.slice(4));
  await sleep(200);
}
const DEST = {
  inline: { attr: "inline", re: "на этот лист", name: "«На этот лист»" },
  pages: { attr: "pages", re: "отдельн", name: "«Отдельными листами»" },
};
/** дождаться диалога «Куда выгрузить материал?» и нажать кнопку */
async function clickDialog(page, dest, { timeout = 5000 } = {}) {
  const d = DEST[dest] || DEST.inline;
  const find = `(() => {
    const dlg = [...document.querySelectorAll(".bd-dialog")].find(el => !el.hidden && el.offsetWidth > 2 && el.offsetHeight > 2);
    if (!dlg) return null;
    const byAttr = dlg.querySelector('[data-bd-dest="${d.attr}"]');
    const byText = [...dlg.querySelectorAll("button, [role=button], a")].find(x => new RegExp(${JSON.stringify(d.re)}, "i").test((x.textContent || "") + " " + (x.title || "")));
    const b = byAttr || byText;
    return b ? ((b.textContent || b.title || "").trim().slice(0, 40) || "ok") : null;
  })()`;
  let label;
  try { label = await page.waitFor(find, { timeout, label: "диалог «Куда выгрузить материал?» → " + d.name }); } catch (_) { return null; }
  await page.eval(`(() => {
    const dlg = [...document.querySelectorAll(".bd-dialog")].find(el => !el.hidden && el.offsetWidth > 2 && el.offsetHeight > 2);
    if (!dlg) return false;
    const byAttr = dlg.querySelector('[data-bd-dest="${d.attr}"]');
    const byText = [...dlg.querySelectorAll("button, [role=button], a")].find(x => new RegExp(${JSON.stringify(d.re)}, "i").test((x.textContent || "") + " " + (x.title || "")));
    const b = byAttr || byText;
    if (b) { b.click(); return true; }
    return false;
  })()`);
  await sleep(120);
  return label;
}
const storeRows = (page, pageKey) => page.eval(`${B}.dump(${JSON.stringify(pageKey)})`);
function rowsOf(rows, type) { return (rows || []).filter(r => r.item && (r.item.t === type || (type === "pg" && r.item.t === "pg"))); }
function rectOverlap(a, b) {
  const aw = a.w || 0, ah = a.h || 0, bw = b.w || 0, bh = b.h || 0;
  return !(a.x + aw <= b.x || b.x + bw <= a.x || a.y + ah <= b.y || b.y + bh <= a.y);
}
async function inkAt(page, side, box) { return page.eval(`${B}.ink(${JSON.stringify(side)}, ${JSON.stringify(box)})`); }
/** ждать, пока в логическом прямоугольнике появится краска (картинка/надпись/штрих) */
async function waitInk(page, side, box, minFrac, label, timeout = 8000) {
  try {
    await page.waitFor(`(() => { const r = ${B}.ink(${JSON.stringify(side)}, ${JSON.stringify(box)}); return r && r.frac > ${minFrac} ? 1 : 0; })()`,
      { timeout, label });
  } catch (_) {
    const r = await inkAt(page, side, box);
    throw new Error((label || "нет краски") + " (ink=" + JSON.stringify(r) + ")");
  }
}

/* ---------- сами проверки ---------- */
const TESTS = [];
const test = (id, name, fn) => TESTS.push({ id, name, fn });

test("A0", "Стенд: обе доски монтируются, fake-канал доставляет присутствие", async ({ page }) => {
  await fresh(page);
  const st = await page.eval(`(() => ({
    teacher: !!(${B}.handles.teacher), student: !!(${B}.handles.student),
    pages: ${B}.pageButtons("teacher"),
    channelName: ${B}.CHANNEL,
    boot: window.__standError || null,
  }))()`);
  if (st.boot) throw new Error("стенд не смонтировался при загрузке: " + st.boot);
  if (!st.teacher || !st.student) throw new Error("Board.mount не вернул доски для teacher/student");
  if (!st.pages.includes("Теория")) throw new Error("На доске нет листа «Теория», кнопки: " + JSON.stringify(st.pages));
  if (st.channelName !== "live-test") throw new Error("стенд поднял не тот канал: " + st.channelName);
  await page.waitFor(`(() => { const t = document.querySelector("#bd-teacher .bd-who").textContent || ""; const s = document.querySelector("#bd-student .bd-who").textContent || ""; return /ученик/i.test(t) && /учител/i.test(s) ? 1 : 0; })()`,
    { timeout: 8000, label: "доски видят друг друга в присутствии (.bd-who)" });
});

test("SMOKE", "v54: доска монтируется без исключений, листы/инструменты рендерятся, ✥ есть", async ({ page }) => {
  await fresh(page);
  const st = await page.eval(`(() => {
    const b = ${B}; const h = b.handles.teacher; const r = b.root("teacher");
    return {
      cv: !!b.cv("teacher"),
      tools: [...r.querySelectorAll("[data-tool]")].map(x => x.dataset.tool),
      acts: [...r.querySelectorAll("[data-act]")].map(x => x.dataset.act),
      pages: b.pageButtons("teacher"),
      info: b.info("teacher"),
      who: (r.querySelector(".bd-who") || {}).textContent || "",
    };
  })()`);
  if (!st.cv) throw new Error("на доске нет canvas .bd-cv");
  for (const t of ["pen", "hl", "text", "erase", "hand"]) if (!st.tools.includes(t)) throw new Error("нет инструмента «" + t + "»; есть: " + JSON.stringify(st.tools));
  if (!st.tools.includes("move")) throw new Error("нет инструмента ✥ «Переместить»; есть: " + JSON.stringify(st.tools));
  if (!st.tools.includes("touch")) throw new Error("нет инструмента 👆 touch; есть: " + JSON.stringify(st.tools));
  for (const a of ["attach", "snap", "embed"]) if (!st.acts.includes(a)) throw new Error("нет кнопки [data-act=" + a + "]; есть: " + JSON.stringify(st.acts));
  if (st.pages.length < 3) throw new Error("листы не отрисованы: " + JSON.stringify(st.pages));
  if (!st.info) throw new Error("mount().info() не вернул данные");
  if (!st.info.ready) throw new Error("info().ready не true после монтирования");
  if (st.info.width !== 800) throw new Error("info().width=" + st.info.width + " (ожидали 800)");
  if (!(st.info.anchors > 0)) throw new Error("якоря не размечены (info().anchors=" + st.info.anchors + ")");
  if (page.errors.length) throw new Error("исключения на странице: " + page.errors.join(" | ").slice(0, 800));
});

test("B1", "Синхронизация: штрих учителя появляется у ученика через канал", async ({ page }) => {
  await fresh(page);
  const g = await geometry(page, "teacher", ".sentence");
  if (!g) throw new Error("на доске нет .sentence");
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push([g.x + 10 + (g.w - 20) * i / 6, g.y + g.h * 0.75]);
  await drawStroke(page, "teacher", pts);
  await page.waitFor(`(() => { const rows = ${B}.dump("theory"); return rows.some(r => r.item && r.item.t === "s") ? 1 : 0; })()`,
    { timeout: 5000, label: "штрих сохранён в общем api" });
  await waitInk(page, "student", { x: g.x, y: g.y - 10, w: g.w, h: g.h + 20 }, 0.0002, "у ученика не появился штрих учителя");
});

test("C", "Якорь: штрих остаётся на том же тексте при сдвинутом макете второй стороны (+remount)", async ({ page }) => {
  await fresh(page);
  // 1) искусственно сдвигаем макет учителя вниз (padding-top листа: DOM-структура та же)
  await shiftBoard(page, "teacher", 150);
  const geo = await page.eval(`(() => ({ t: ${B}.logicalRect("teacher", ".sentence"), s: ${B}.logicalRect("student", ".sentence"), scaleT: ${B}.scaleOf("teacher"), scaleS: ${B}.scaleOf("student") }))()`);
  if (!geo.t || !geo.s) throw new Error("не нашли .sentence на одной из досок");
  if (geo.t.y - geo.s.y < 80) throw new Error("макет учителя не сдвинулся (ΔY=" + (geo.t.y - geo.s.y).toFixed(1) + " логических px)");

  // 2) ученик подчёркивает своё предложение
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push([geo.s.x + 8 + (geo.s.w - 16) * i / 6, geo.s.y + geo.s.h * 0.78]);
  await drawStroke(page, "student", pts);
  await page.waitFor(`(() => { const rows = ${B}.dump("theory"); return rows.some(r => r.item && r.item.t === "s") ? rows : null; })()`,
    { timeout: 5000, label: "штрих ученика сохранён" });

  // 3) у учителя штрих должен оказаться на ЕГО предложении (сдвинутом), а не выше/ниже
  const check = await page.eval(`(() => {
    const b = ${B}; const g = b.logicalRect("teacher", ".sentence");
    return { near: b.ink("teacher", { x: g.x, y: g.y - 12, w: g.w, h: g.h + 24 }), g };
  })()`);
  if (!check.near || check.near.frac <= 0.0005) {
    throw new Error("у учителя НЕТ штриха на его предложении (ожидали штрих на тексте, ink=" + JSON.stringify(check.near) + ")");
  }
  const cy = check.near.bbox.cy, top = check.g.y, bottom = check.g.y + check.g.h;
  if (cy < top - 18 || cy > bottom + 22) {
    throw new Error("штрих у учителя вне текста: центр краски y=" + cy.toFixed(1) + ", предложение " + top.toFixed(1) + ".." + bottom.toFixed(1) + " (сдвиг " + (geo.t.y - geo.s.y).toFixed(0) + "px не учтён)");
  }
  const above = await inkAt(page, "teacher", { x: geo.s.x, y: geo.s.y - 12, w: geo.s.w, h: geo.s.h + 24 });
  if (above.frac > Math.max(0.0003, check.near.frac * 0.5)) {
    throw new Error("штрих продублирован по несдвинутой позиции (выше текста): ink=" + JSON.stringify(above));
  }

  // 4) и после перемонтирования доски штрих остаётся на тексте (якорь сохраняется)
  await remount(page, "teacher");
  await shiftBoard(page, "teacher", 150);
  await page.waitFor(`(() => { const b = ${B}; const g = b.logicalRect("teacher", ".sentence"); const r = b.ink("teacher", { x: g.x, y: g.y - 12, w: g.w, h: g.h + 24 }); return r && r.bbox && r.bbox.cy >= g.y - 18 && r.bbox.cy <= g.y + g.h + 22 ? 1 : 0; })()`,
    { timeout: 8000, label: "после remount штрих снова на тексте учителя (якорь)" });
});

test("D1", "Вложения: две картинки через «На этот лист» не накладываются, видны второй стороне, живы после remount", async ({ page, fixtures }) => {
  await fresh(page);
  await uploadFiles(page, "teacher", [fixtures.files.image1]);
  const d1 = await clickDialog(page, "inline");
  if (!d1) throw new Error("нет диалога «Куда выгрузить материал?» с кнопкой «На этот лист» после загрузки картинки");
  await page.waitFor(`(() => ${B}.dump("theory").some(r => r.item && r.item.t === "i"))()`, { timeout: 8000, label: "первая картинка на листе" });
  await uploadFiles(page, "teacher", [fixtures.files.image2]);
  const d2 = await clickDialog(page, "inline");
  if (!d2) throw new Error("нет диалога «На этот лист» при повторной загрузке");
  await page.waitFor(`(() => ${B}.dump("theory").filter(r => r.item && r.item.t === "i").length >= 2)()`, { timeout: 8000, label: "вторая картинка на листе" });
  const rows = await storeRows(page, "theory");
  const imgs = rowsOf(rows, "i");
  if (imgs.length < 2) throw new Error("картинок на листе: " + imgs.length);
  const a = imgs[0].item, b = imgs[1].item;
  if (rectOverlap(a, b)) {
    throw new Error("картинки наложились: #1 x=" + a.x + " y=" + a.y + " w=" + a.w + " h=" + a.h + "; #2 x=" + b.x + " y=" + b.y + " w=" + b.w + " h=" + b.h + " — вторую надо ставить ниже (y = низ + 30)");
  }
  // ученик увидел без перезагрузки
  for (const it of [a, b]) {
    await waitInk(page, "student", { x: it.x, y: it.y, w: it.w || 460, h: it.h || 300 }, 0.01, "ученик видит картинку y=" + it.y);
  }
  // и после перемонтирования обе доски показывают те же картинки
  await page.eval(`${B}.whenIdle("teacher")`);
  await remount(page, "teacher");
  await remount(page, "student");
  const rows2 = await storeRows(page, "theory");
  const imgs2 = rowsOf(rows2, "i");
  if (imgs2.length < 2) throw new Error("после remount картинки исчезли из базы: " + imgs2.length);
  for (const it of [imgs2[0].item, imgs2[1].item]) {
    await waitInk(page, "student", { x: it.x, y: it.y, w: it.w || 460, h: it.h || 300 }, 0.01, "после remount картинка видна ученику");
  }
});

test("D2", "Перемещение: инструмент ✥ двигает картинку, позиция сохраняется и видна второй стороне", async ({ page, fixtures }) => {
  await fresh(page);
  await uploadFiles(page, "teacher", [fixtures.files.image1]);
  await clickDialog(page, "inline");
  await page.waitFor(`(() => ${B}.dump("theory").some(r => r.item && r.item.t === "i"))()`, { timeout: 8000, label: "картинка на листе" });
  const old = rowsOf(await storeRows(page, "theory"), "i")[0].item;
  const btn = await page.eval(`(() => { const b = ${B}.findButton("teacher", /перемест|move|✥/); return b ? ((b.title || "") + " " + (b.textContent || "")).trim() : null; })()`);
  if (!btn) throw new Error("нет инструмента «Переместить» (✥) на панели доски; есть: " + JSON.stringify(await page.eval(`${B}.toolbarText("teacher")`)));
  await page.eval(`${B}.clickButton("teacher", /перемест|move|✥/); true`);
  await sleep(120);
  const scaleT = await page.eval(`${B}.scaleOf("teacher")`);
  const oldW = old.w || 460, oldH = old.h || 300;
  const start = await page.eval(`${B}.point("teacher", ${old.x} + ${oldW} / 2, ${old.y} + ${oldH} / 2)`);
  if (!start) throw new Error("не удалось посчитать координаты картинки");
  await page.drag(start.x, start.y, start.x + 90 * scaleT, start.y + 70 * scaleT, 10);
  const moved = await page.waitFor(`(() => {
    const b = ${B}; const rows = b.dump("theory"); const im = rows.filter(r => r.item && r.item.t === "i");
    const m = im.find(r => Math.abs(r.item.x - (${old.x} + 90)) < 35 && Math.abs(r.item.y - (${old.y} + 70)) < 35);
    return m ? m.item : null;
  })()`, { timeout: 8000, label: "картинка переместилась в базе (x+90, y+70)" });
  if (moved.w == null || moved.w === 0) throw new Error("после перемещения потерялись размеры картинки: " + JSON.stringify(moved));
  await waitInk(page, "student", { x: moved.x, y: moved.y, w: moved.w || 460, h: moved.h || 300 }, 0.01, "вторая сторона увидела перемещение без перезагрузки");
  // доска перемонтирована — позиция сохранилась
  await page.eval(`${B}.whenIdle("teacher")`);
  await remount(page, "teacher");
  await waitInk(page, "teacher", { x: moved.x, y: moved.y, w: moved.w || 460, h: moved.h || 300 }, 0.01, "после remount картинка на новой позиции");
});

test("D3", "Дополнительный лист («Отдельными листами», PDF) сохраняется в \"_pages\" и жив после remount", async ({ page, fixtures }) => {
  await fresh(page);
  const before = (await page.eval(`${B}.pageButtons("teacher")`)).length;
  await uploadFiles(page, "teacher", [fixtures.files.pdf]);
  const chosen = await clickDialog(page, "pages", { timeout: 5000 });
  if (!chosen) throw new Error("нет диалога «Куда выгрузить материал?» с кнопкой «Отдельными листами» для PDF");
  await page.waitFor(`(() => ${B}.pageButtons("teacher").length > ${before} ? 1 : 0)()`,
    { timeout: 12000, label: "новые листы у учителя" });
  await page.waitFor(`(() => ${B}.pageButtons("student").length > ${before} ? 1 : 0)()`,
    { timeout: 12000, label: "новые листы пришли ученику без перезагрузки" });
  const after = await page.eval(`${B}.pageButtons("teacher")`);
  await page.waitFor(`(() => ${B}.dump(${JSON.stringify(PAGE_KEY)}).filter(r => r.item && r.item.t === "pg").length > 0 ? 1 : 0)()`,
    { timeout: 8000, label: "доп. листы сохранены в api \"" + PAGE_KEY + "\" строками {t:\"pg\"}" });
  // смотрим новый лист
  await page.eval(`(() => { const r = ${B}.root("student"); const bs = [...r.querySelectorAll("[data-bpage]")]; const b = bs[bs.length - 1]; if (b) b.click(); return !!b; })()`);
  await sleep(300);
  // содержимое нового листа: текст или картинка/слайд (v54 pdf/pdf-заглушка могут дать .bd-slide с img)
  const content = await page.eval(`(() => {
    const s = ${B}.root("student").querySelector(".bd-bg .bd-sheet");
    if (!s) return "";
    const txt = (s.textContent || "").trim();
    if (txt) return "text:" + txt.slice(0, 80);
    const im = s.querySelector("img");
    if (im && (im.getAttribute("src") || "").length > 20) return "img:" + (im.getAttribute("src") || "").slice(0, 40);
    return "";
  })()`);
  if (!content) throw new Error("новый лист у ученика пустой (нет ни текста, ни изображения)");
  // remount — дополнительные листы не исчезают
  await page.eval(`${B}.whenIdle("teacher")`);
  await remount(page, "teacher");
  await remount(page, "student");
  const afterRemountT = await page.eval(`${B}.pageButtons("teacher")`);
  const afterRemountS = await page.eval(`${B}.pageButtons("student")`);
  if (afterRemountT.length < after.length) throw new Error("после remount у учителя пропали доп. листы: было " + after.length + ", стало " + afterRemountT.length);
  if (afterRemountS.length < after.length) throw new Error("после remount у ученика пропали доп. листы: было " + after.length + ", стало " + afterRemountS.length);
  const savedPages = await storeRows(page, PAGE_KEY);
  const pgRows = rowsOf(savedPages, "pg");
  if (pgRows.some(r => (r.item.html || "").length > PAGE_HTML_MAX)) throw new Error("html доп. листа в базе больше лимита 55000");
});

test("D4", "Большой лист: html ≤55000, одинаков у обеих сторон, сохранён в \"_pages\" и жив после remount", async ({ page }) => {
  await fresh(page);
  const html = "<div class='bd-sheet'><h2>Большой лист</h2><p>" + "Проверочный длинный текст. ".repeat(4000) + "</p></div>"; // ~120k > 55k
  const key = await page.eval(`(async () => {
    const b = ${B};
    const key = b.handles.teacher.addPage("Большой", ${JSON.stringify(html)}, true);
    await b.handles.teacher.whenIdle();
    await b.handles.student.whenIdle();
    return key;
  })()`);
  if (!key) throw new Error("addPage не вернул ключ нового листа");
  await page.waitFor(`(() => { const p = ${B}.info("student").pages.find(x => x.key === ${JSON.stringify(String(key))}); return p ? 1 : 0; })()`,
    { timeout: 8000, label: "лист пришёл ученику через broadcast" });
  const r = await page.eval(`(() => {
    const b = ${B}; const t = b.info("teacher"), s = b.info("student");
    return { t: t.pages.find(p => p.key === ${JSON.stringify(String(key))}) || null, s: s.pages.find(p => p.key === ${JSON.stringify(String(key))}) || null };
  })()`);
  if (!r.t || !(r.t.htmlLen > 0) || r.t.htmlLen > PAGE_HTML_MAX) throw new Error("у учителя html не в лимите/нет листа: " + JSON.stringify(r.t));
  if (!r.s) throw new Error("лист не пришёл ученику через broadcast: " + JSON.stringify(r.s));
  if (r.s.htmlLen !== r.t.htmlLen) throw new Error("html листа разошёлся между сторонами: teacher=" + JSON.stringify(r.t) + " student=" + JSON.stringify(r.s));
  await page.waitFor(`(() => ${B}.dump(${JSON.stringify(PAGE_KEY)}).some(r => r.item && r.item.t === "pg" && r.item.key === ${JSON.stringify(String(key))}) ? 1 : 0)()`,
    { timeout: 8000, label: "большой лист сохранён в базе под ключом \"" + PAGE_KEY + "\"" });
  const row = await page.eval(`(() => ${B}.dump(${JSON.stringify(PAGE_KEY)}).find(r => r.item && r.item.t === "pg" && r.item.key === ${JSON.stringify(String(key))}) || null)()`);
  if (!row) throw new Error("нет строки большого листа в \"" + PAGE_KEY + "\"");
  if (row.item.html.length !== r.t.htmlLen) throw new Error("длина html в базе (" + row.item.html.length + ") не совпадает с info().pages.htmlLen (" + r.t.htmlLen + ")");
  await page.eval(`${B}.whenIdle("teacher")`);
  await remount(page, "teacher");
  const after = await page.eval(`(() => ${B}.info("teacher").pages.find(p => p.key === ${JSON.stringify(String(key))}) || null)()`);
  if (!after) throw new Error("после remount большой лист пропал");
  if (after.htmlLen !== r.t.htmlLen) throw new Error("после remount html листа изменился: было " + r.t.htmlLen + ", стало " + after.htmlLen);
});

test("E1", "Текст: T → тап → .bd-editor в фокусе, ввод, ручка размера, Enter → надпись на листе", async ({ page }) => {
  await fresh(page);
  const tool = await page.eval(`(() => { const b = ${B}.findButton("student", /текст/); return b ? ((b.title || "") + " " + (b.textContent || "")).trim() : null; })()`);
  if (!tool) throw new Error("нет инструмента «Текст» на панели ученика");
  await page.eval(`${B}.clickButton("student", /текст/); true`);
  await sleep(100);
  const p = await page.eval(`${B}.point("student", 140, 300)`);
  if (!p) throw new Error("не удалось получить координаты canvas ученика");
  await page.mouse("mousePressed", p.x, p.y);
  await page.mouse("mouseReleased", p.x, p.y);
  await page.waitFor(`(() => ${B}.textEditor() ? 1 : 0)()`, { timeout: 5000, label: "окошко-редактор .bd-editor после тапа инструментом T" });
  await page.waitFor(`(() => ${B}.editorFocused() ? 1 : 0)()`, { timeout: 4000, label: ".bd-editor в фокусе (document.activeElement внутри)" });
  const ed = await page.eval(`${B}.textEditor()`);
  if (!ed) throw new Error(".bd-editor исчез до ввода текста");
  if (!/TEXTAREA|DIV|P/.test(ed.tag)) throw new Error("редактор не похож на окно ввода: " + ed.tag);
  if (!ed.handle) throw new Error("в .bd-editor нет ручки изменения размера .bd-editor-handle");
  // ввод текста
  await page.cdp.send("Input.insertText", { text: "Проверка текста" });
  await page.waitFor(`(() => { const e = ${B}.textEditor(); return e && /Проверка текста/.test(e.value) ? 1 : 0; })()`,
    { timeout: 4000, label: "ввод текста в .bd-editor" });
  // ручка изменения размера
  const before = ed.box;
  await page.drag(ed.handle.cx, ed.handle.cy, ed.handle.cx + 90, ed.handle.cy + 60, 10);
  await sleep(250);
  const after = await page.eval(`${B}.editorBoxNow()`);
  if (!after) throw new Error("окошко-редактор закрылось при перетаскивании ручки");
  if (!(after.w > before.w + 20 || after.h > before.h + 10)) {
    throw new Error("ручка размера не меняет окошко: было " + before.w.toFixed(0) + "×" + before.h.toFixed(0) + ", стало " + after.w.toFixed(0) + "×" + after.h.toFixed(0));
  }
  // Enter — сохранить
  await page.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" });
  await page.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  const row = await page.waitFor(`(() => { const rows = ${B}.dump("theory"); const m = rows.find(r => r.item && r.item.t === "t" && /Проверка текста/.test(r.item.s || "")); return m || null; })()`,
    { timeout: 6000, label: "надпись сохранена на листе" });
  const it = row.item;
  if (!it.w || !it.h) throw new Error("у надписи не сохранены размеры w/h (после изменения ручкой): " + JSON.stringify(it));
  // вторая сторона видит надпись без перезагрузки
  await waitInk(page, "teacher", { x: it.x - 10, y: it.y - 10, w: (it.w || 300) + 20, h: (it.h || 80) + 20 }, 0.0003, "надпись видна учителю");
});

test("E2", "Текст: надпись сохраняется после remount доски", async ({ page }) => {
  await fresh(page);
  await page.eval(`${B}.clickButton("student", /текст/); true`);
  await sleep(80);
  const p = await page.eval(`${B}.point("student", 150, 340)`);
  if (!p) throw new Error("не удалось получить координаты canvas ученика");
  await page.mouse("mousePressed", p.x, p.y);
  await page.mouse("mouseReleased", p.x, p.y);
  await page.waitFor(`(() => ${B}.textEditor() ? 1 : 0)()`, { timeout: 5000, label: "окошко-редактор" });
  await page.waitFor(`(() => ${B}.editorFocused() ? 1 : 0)()`, { timeout: 4000, label: ".bd-editor в фокусе" });
  await page.cdp.send("Input.insertText", { text: "Текст после перезагрузки" });
  await sleep(150);
  await page.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" });
  await page.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await page.waitFor(`(() => ${B}.dump("theory").some(r => r.item && r.item.t === "t" && /после перезагрузки/.test(r.item.s || "")) ? 1 : 0)()`,
    { timeout: 6000, label: "надпись сохранена" });
  await remount(page, "student");
  const box = await page.eval(`(() => { const it = ${B}.dump("theory").find(r => r.item && r.item.t === "t"); if (!it) return null; return { x: it.item.x - 10, y: it.item.y - 10, w: (it.item.w || 300) + 20, h: (it.item.h || 80) + 20 }; })()`);
  if (!box) throw new Error("надпись пропала из базы после remount");
  await waitInk(page, "student", box, 0.0003, "после remount надпись снова на листе");
});

/* ---------- раннер ---------- */
function ensureArtifacts() { fs.mkdirSync(ARTIFACTS, { recursive: true }); }

export async function runBoardTests({ page, baseUrl, fixtures, only = process.env.BOARD_ONLY || "" } = {}) {
  const fx = fixtures || makeFixtures();
  const filter = String(only).split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const results = [];
  for (const t of TESTS) {
    if (filter.length && !filter.some(f => t.id.toLowerCase().startsWith(f.toLowerCase()))) continue;
    const pageErrorsBefore = page.errors.length;
    const consoleBefore = page.console.length;
    let pass = false, err = null;
    const t0 = Date.now();
    try {
      await t.fn({ page, fixtures: fx, baseUrl });
      pass = true;
    } catch (e) {
      err = e;
      try { ensureArtifacts(); await page.screenshot(path.join(ARTIFACTS, "board-" + t.id + ".png")); } catch (_) {}
    }
    const consoleNew = page.console.slice(consoleBefore);
    const pageErrors = page.errors.slice(pageErrorsBefore);
    results.push({
      id: t.id, name: t.name, pass, ms: Date.now() - t0,
      error: err ? String(err.message || err) : null,
      pageErrors, consoleErrors: consoleNew.filter(c => c.type === "error").map(c => c.text).slice(0, 8),
    });
    const mark = pass ? "PASS" : "FAIL";
    console.log("[" + mark + "] " + t.id + " " + t.name + (pass ? "" : "\n       " + ((err && err.message) || err)));
    if (!pass) {
      if (pageErrors.length) console.log("       pageErrors: " + pageErrors.join(" | ").slice(0, 1200));
      if (consoleNew.filter(c => c.type === "error").length) console.log("       console: " + consoleNew.filter(c => c.type === "error").map(c => c.text).join(" | ").slice(0, 1200));
    }
  }
  if (!fixtures) fx.cleanup();
  return results;
}

export async function runBoardStandalone() {
  const port = +(process.env.PORT || 8765);
  const server = await startServer({ port });
  const browser = await launch({
    headless: process.env.BOARD_HEADLESS !== "0",
    width: 1600, height: 1200,
    port: +(process.env.CDP_PORT || 9333),
  });
  try {
    const page = await browser.newPage("about:blank");
    await page.goto(server.url + "/_test/board.html");
    await page.waitFor(`!!window.__board && !!window.__board.handles.teacher && !!window.__board.handles.student`, { timeout: 15000, label: "стенд доски загрузился" });
    const results = await runBoardTests({ page, baseUrl: server.url });
    const failed = results.filter(r => !r.pass).length;
    console.log("\nИтог по доске v54: " + (results.length - failed) + "/" + results.length + " PASS" + (failed ? ", " + failed + " FAIL" : "") +
      (failed ? "\nСкриншоты падений: " + ARTIFACTS : ""));
    return { results, failed };
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBoardStandalone().then(({ failed }) => process.exit(failed ? 1 : 0))
    .catch(e => { console.error("ОШИБКА СТЕНДА:", (e && e.stack) || e); process.exit(2); });
}
