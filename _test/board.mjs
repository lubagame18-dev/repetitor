/* Проверки доски v55 (якоря, вложения, перемещение, текст, доп. листы) на стенде _test/board.html.
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
const PAGE_KEY = "_pages";      // api-ключ доп. листов в v55
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
/** «живой урок»: у teacher свой HTML листа (TEACHER-KEYS), у student свой (STUDENT-SHEET) */
async function freshLive(page, opts) {
  await page.eval(`${B}.clearStore(); ${B}.HUB.clearLog(); true`);
  await page.eval(`${B}.mountLiveBoth(${JSON.stringify(opts || {})})`);
  await page.eval("document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true").catch(() => {});
  await sleep(200);
}
const bgOf = (page, side) => page.eval(`${B}.bgHtml(${JSON.stringify(side)})`);
const bgSourceOf = (page, side) => page.eval(`${B}.bgSource(${JSON.stringify(side)})`);
async function waitBg(page, side, want = "remote", timeout = 8000) {
  return page.eval(`${B}.waitBgSource(${JSON.stringify(side)}, ${JSON.stringify(want)}, ${timeout})`);
}
/** дождаться, что фон учителя стал HTML ученика (STUDENT-SHEET) и bgSource === "remote" */
async function awaitUnifiedBg(page, timeout = 8000) {
  try { await waitBg(page, "teacher", "remote", timeout); }
  catch (e) {
    throw new Error("у учителя не включился фон ученика: " + e.message +
      "; bgSource=" + JSON.stringify(await bgSourceOf(page, "teacher")) +
      "; bg=" + JSON.stringify(String(await bgOf(page, "teacher")).slice(0, 120)) +
      "; канал bg=" + JSON.stringify(await page.eval(`${B}.channelLog("bg").length`)) +
      ", bgreq=" + JSON.stringify(await page.eval(`${B}.channelLog("bgreq").length`)));
  }
  try { await page.eval(`${B}.waitBgContains("teacher", "STUDENT-SHEET", ${timeout})`); }
  catch (e) { throw new Error("bgSource=remote, но в фоне учителя нет STUDENT-SHEET: " + e.message); }
}
const setToolOn = (page, side, tool) => page.eval(`${B}.setTool(${JSON.stringify(side)}, ${JSON.stringify(tool)})`);
/** нарисовать горизонтальный штрих в пустом месте: ниже элемента refSel на dy логических px */
async function drawStrokeInGap(page, side, refSel, dy, len) {
  const r = await geometry(page, side, refSel);
  if (!r) throw new Error("не нашли «" + refSel + "» на доске «" + side + "»");
  const y = r.bottom + dy, x0 = r.x + 20, x1 = x0 + (len || 180);
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push([x0 + (x1 - x0) * i / 6, y]);
  await setToolOn(page, side, "pen");
  await drawStroke(page, side, pts);
  return { x0, x1, y, ref: r };
}
/** дождаться появления штриха (t:"s") в базе листа и вернуть строку */
async function waitStrokeRow(page, pageKey = "theory", timeout = 6000) {
  return page.waitFor(`(() => { const rows = ${B}.dump(${JSON.stringify(pageKey)}); const s = rows.filter(r => r.item && r.item.t === "s"); return s.length ? s[s.length - 1] : null; })()`,
    { timeout, label: "штрих сохранён в api (" + pageKey + ")" });
}
/** прямоугольник вокруг нарисованного в пустоте штриха (для ink()) */
const gapBox = (g, pad = 40) => ({ x: g.x0 - pad, y: g.y - 28, w: (g.x1 - g.x0) + pad * 2, h: 56 });

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

test("SMOKE", "v55: доска монтируется без исключений, листы/инструменты рендерятся, ✥ есть", async ({ page }) => {
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

  /* --- сохранность: снимок 📸, Board.keep(), доска после включения bg-режима --- */
  const snap = await page.eval(`(() => {
    const r = ${B}.root("teacher"); const b = r.querySelector('[data-act="snap"]');
    return { exists: !!b, text: b ? ((b.title || "") + " " + (b.getAttribute("aria-label") || "") + " " + b.textContent) : "", acts: [...r.querySelectorAll("[data-act]")].map(x => x.dataset.act) };
  })()`);
  if (!snap.exists) throw new Error("нет кнопки снимка 📸 [data-act=snap]; есть: " + JSON.stringify(snap.acts));
  if (!/снимок|📸/i.test(snap.text)) throw new Error("кнопка [data-act=snap] не про снимок листа: " + JSON.stringify(snap.text));
  const keep = await page.eval(`${B}.keepProbe("teacher")`);
  if (!keep.hasKeep || !keep.hasRelease) throw new Error("нет Board.keep()/Board.release(): " + JSON.stringify(keep));
  if (keep.err) throw new Error("Board.keep() упал: " + keep.err);
  if (!keep.same) throw new Error("Board.keep() при повторном вызове создал новую доску вместо переиспользования инстанса");

  /* включаем «живой урок» (bg-режим) — кнопки/инструменты/_pages должны остаться рабочими */
  await freshLive(page);
  const live = await page.eval(`(() => {
    const b = ${B}; const r = b.root("teacher"); const i = b.info("teacher");
    return { tools: [...r.querySelectorAll("[data-tool]")].map(x => x.dataset.tool),
             acts: [...r.querySelectorAll("[data-act]")].map(x => x.dataset.act),
             pages: b.pageButtons("teacher").length, width: i && i.width, ready: i && i.ready,
             bgSource: b.bgSource("teacher"), snap: !!r.querySelector('[data-act="snap"]') };
  })()`);
  for (const t of ["pen", "hl", "text", "erase", "hand", "move", "touch"]) if (!live.tools.includes(t)) throw new Error("в bg-режиме пропал инструмент «" + t + "»; есть: " + JSON.stringify(live.tools));
  for (const a of ["attach", "snap", "embed"]) if (!live.acts.includes(a)) throw new Error("в bg-режиме пропала кнопка [data-act=" + a + "]; есть: " + JSON.stringify(live.acts));
  if (!live.snap) throw new Error("в bg-режиме пропала кнопка снимка 📸");
  if (live.width !== 800 || !live.ready) throw new Error("в bg-режиме info() сломан: width=" + live.width + ", ready=" + live.ready);
  if (!["remote", "own", "static"].includes(live.bgSource)) throw new Error("info().bgSource в bg-режиме = " + JSON.stringify(live.bgSource) + " (ожидали remote/own/static)");
  const newKey = await page.eval(`(async () => {
    const b = ${B}; const key = b.handles.teacher.addPage("SMOKE bg", "<div class='bd-sheet'><p>Лист из bg-режима</p></div>", true);
    await b.handles.teacher.whenIdle(); return key;
  })()`);
  if (!newKey) throw new Error("addPage() в bg-режиме не вернул ключ листа");
  await page.waitFor(`(() => ${B}.dump(${JSON.stringify(PAGE_KEY)}).some(r => r.item && r.item.t === "pg" && r.item.key === ${JSON.stringify(String(newKey))}) ? 1 : 0)()`,
    { timeout: 6000, label: "лист, добавленный в bg-режиме, сохранён в \"" + PAGE_KEY + "\"" });
  await page.waitFor(`(() => ${B}.pageButtons("teacher").length > ${live.pages} ? 1 : 0)()`, { timeout: 6000, label: "лист, добавленный в bg-режиме, появился в списке листов" });

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
  // содержимое нового листа: текст или картинка/слайд (v55 pdf/pdf-заглушка могут дать .bd-slide с img)
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
  // ручка изменения размера (после ввода перечитываем: инлайн-редактор авто-растёт, старые координаты ручки устаревают)
  const ed2 = await page.eval(`${B}.textEditor()`);
  if (!ed2 || !ed2.handle) throw new Error("после ввода в .bd-editor пропала ручка размера .bd-editor-handle");
  const before = ed2.box;
  await page.drag(ed2.handle.cx, ed2.handle.cy, ed2.handle.cx + 90, ed2.handle.cy + 60, 10);
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

/* ---------- F: единый фон «живого» листа (ученик → учитель) ---------- */
test("F1", "Единый фон: у учителя свой live-лист (TEACHER-KEYS), ученик отрисовал свой → фон учителя = HTML ученика (STUDENT-SHEET, bgSource=remote)", async ({ page }) => {
  /* «учитель открыл лист первым»: сначала монтируем только учителя — он обязан показать СВОЙ live-лист */
  await page.eval(`${B}.clearStore(); ${B}.HUB.clearLog(); true`);
  await page.eval(`${B}.mountLiveTeacher()`);
  const own = await bgOf(page, "teacher");
  if (!/TEACHER-KEYS/.test(own)) throw new Error("учитель не нарисовал свой live-лист: в фоне нет TEACHER-KEYS — " + String(own).slice(0, 160));
  if (/STUDENT-SHEET/.test(own)) throw new Error("без ученика у учителя уже лист ученика — стенд стартовал неверно");
  const srcOwn = await bgSourceOf(page, "teacher");
  if (srcOwn === "remote") throw new Error("bgSource=remote без ученика (свой live-лист должен быть own)");
  /* теперь ученик отрисовал свой live-лист и поделился им */
  await page.eval(`${B}.mountLiveStudent()`);
  const stOwn = await bgOf(page, "student");
  if (!/STUDENT-SHEET/.test(stOwn)) throw new Error("ученик не нарисовал свой live-лист: в фоне нет STUDENT-SHEET — " + String(stOwn).slice(0, 160));
  await awaitUnifiedBg(page);
  const th = await bgOf(page, "teacher");
  if (!/STUDENT-SHEET/.test(th)) throw new Error("фон учителя не стал HTML ученика (нет STUDENT-SHEET)");
  if (/TEACHER-KEYS/.test(th)) throw new Error("в фоне учителя остался его собственный лист (TEACHER-KEYS) — учитель должен предпочитать фон ученика");
  const pages = await page.eval(`${B}.bgDebug("teacher")`);
  if (!Array.isArray(pages) || !pages.includes("theory")) throw new Error("debug().remoteBgPages не содержит theory: " + JSON.stringify(pages));
  const stSrc = await bgSourceOf(page, "student");
  if (stSrc === "remote") throw new Error("ученик применил чужой фон (bgSource=remote) — ученик должен только отдавать свой лист");
  if (page.errors.length) throw new Error("исключения на странице: " + page.errors.join(" | ").slice(0, 800));
});

test("F2", "Рисунок совпадает: ученик рисует в ПУСТОМ месте общего листа — у учителя тот же элемент и координаты, фон ученика", async ({ page }) => {
  await freshLive(page);
  await awaitUnifiedBg(page);
  const g = await drawStrokeInGap(page, "student", "#student-sent", 80, 180);
  const row = await waitStrokeRow(page);
  if (!row || !row.item) throw new Error("штрих не сохранён");
  const a = row.item.a;
  if (!a) throw new Error("штрих в пустом месте сохранён без якоря: " + JSON.stringify(row.item).slice(0, 200));
  const anchorS = await page.eval(`${B}.elementAtAnchor("student", ${JSON.stringify(a.i)})`);
  const anchorT = await page.eval(`${B}.elementAtAnchor("teacher", ${JSON.stringify(a.i)})`);
  if (!anchorS) throw new Error("якорь #" + a.i + " не найден на листе ученика");
  if (!anchorT) throw new Error("якорь #" + a.i + " (из штриха ученика) не найден в фоне учителя — фоны не совпадают");
  for (const [who, an] of [["ученик", anchorS], ["учитель", anchorT]]) {
    const isPara = an.tag === "P" || /student-sent/.test(an.cls) || /Предложение листа ученика/.test(an.text);
    if (!isPara) throw new Error("штрих в пустоте у " + who + " привязан к «" + an.tag + "." + an.cls + "» (id=" + JSON.stringify(an.id) + "), а не к ближайшему абзацу #student-sent");
  }
  const box = gapBox(g);
  const inkS = await inkAt(page, "student", box);
  const inkT = await inkAt(page, "teacher", box);
  if (!inkS || !inkS.bbox) throw new Error("штрих не нарисовался у ученика: " + JSON.stringify(inkS));
  if (!inkT || !inkT.bbox) throw new Error("у учителя нет штриха в том же месте: " + JSON.stringify(inkT));
  const dx = Math.abs(inkS.bbox.cx - inkT.bbox.cx), dy = Math.abs(inkS.bbox.cy - inkT.bbox.cy);
  if (dx > 8 || dy > 8) throw new Error("штрих ученика и учителя разошёлся: центр у ученика (" + inkS.bbox.cx.toFixed(1) + ", " + inkS.bbox.cy.toFixed(1) + "), у учителя (" + inkT.bbox.cx.toFixed(1) + ", " + inkT.bbox.cy.toFixed(1) + "), Δ=(" + dx.toFixed(1) + ", " + dy.toFixed(1) + ") логических px");
  // «в каком элементе»: под центром краски на обеих досках — пустое место листа (не чужой текст)
  const underS = await page.eval(`${B}.elementUnderPoint("student", ${inkS.bbox.cx}, ${inkS.bbox.cy})`);
  const underT = await page.eval(`${B}.elementUnderPoint("teacher", ${inkT.bbox.cx}, ${inkT.bbox.cy})`);
  if (underS && underT && (underS.tag !== underT.tag || underS.id !== underT.id || underS.cls !== underT.cls)) {
    throw new Error("под штрихом у сторон разные элементы листа: ученик «" + underS.tag + "." + underS.cls + "#" + underS.id + "», учитель «" + underT.tag + "." + underT.cls + "#" + underT.id + "»");
  }
  const th = await bgOf(page, "teacher");
  if (!/STUDENT-SHEET/.test(th) || /TEACHER-KEYS/.test(th)) throw new Error("фон учителя не равен фону ученика в момент штриха");
});

test("F3", "Обратная сторона: учитель рисует на общем фоне — у ученика те же координаты и тот же элемент", async ({ page }) => {
  await freshLive(page);
  await awaitUnifiedBg(page);
  if ((await bgSourceOf(page, "teacher")) !== "remote") throw new Error("учитель рисует не на общем фоне (bgSource=" + JSON.stringify(await bgSourceOf(page, "teacher")) + ")");
  const g = await geometry(page, "teacher", "#student-sent");
  if (!g) throw new Error("в общем фоне учителя нет #student-sent");
  const y = g.y + g.h * 0.75, x0 = g.x + 10, x1 = g.x + 210;
  const pts = [];
  for (let i = 0; i <= 6; i++) pts.push([x0 + (x1 - x0) * i / 6, y]);
  await setToolOn(page, "teacher", "pen");
  await drawStroke(page, "teacher", pts);
  const row = await waitStrokeRow(page);
  if (!row || !row.item.a) throw new Error("штрих учителя не сохранён с якорем: " + JSON.stringify(row && row.item).slice(0, 200));
  const a = row.item.a;
  const anchorT = await page.eval(`${B}.elementAtAnchor("teacher", ${JSON.stringify(a.i)})`);
  const anchorS = await page.eval(`${B}.elementAtAnchor("student", ${JSON.stringify(a.i)})`);
  if (!anchorT || !anchorS) throw new Error("якорь #" + a.i + " не найден на одной из сторон (t=" + JSON.stringify(anchorT) + ", s=" + JSON.stringify(anchorS) + ")");
  if (!/student-sent/.test(anchorT.id || "") && anchorT.tag !== "P") throw new Error("штрих учителя привязан к «" + anchorT.tag + "." + anchorT.cls + "», а не к абзацу #student-sent");
  if (anchorT.tag !== anchorS.tag || anchorT.id !== anchorS.id) throw new Error("у сторон разные элементы под якорем: teacher «" + anchorT.tag + "#" + anchorT.id + "» / student «" + anchorS.tag + "#" + anchorS.id + "»");
  const box = { x: x0 - 30, y: y - 26, w: (x1 - x0) + 60, h: 52 };
  const inkT = await inkAt(page, "teacher", box);
  const inkS = await inkAt(page, "student", box);
  if (!inkT || !inkT.bbox) throw new Error("штрих учителя не нарисовался: " + JSON.stringify(inkT));
  if (!inkS || !inkS.bbox) throw new Error("ученик не увидел штрих учителя в том же месте: " + JSON.stringify(inkS));
  const dx = Math.abs(inkT.bbox.cx - inkS.bbox.cx), dy = Math.abs(inkT.bbox.cy - inkS.bbox.cy);
  if (dx > 8 || dy > 8) throw new Error("штрих учителя и ученика разошёлся: teacher (" + inkT.bbox.cx.toFixed(1) + ", " + inkT.bbox.cy.toFixed(1) + "), student (" + inkS.bbox.cx.toFixed(1) + ", " + inkS.bbox.cy.toFixed(1) + "), Δ=(" + dx.toFixed(1) + ", " + dy.toFixed(1) + ")");
});

test("F4", "Запрос фона: ученик не открывал лист, но отдаёт его по bgreq из detached-контейнера; без ученика учитель остаётся на своём фоне", async ({ page }) => {
  /* A) ученик на другом листе (p2): live-лист theory им не рисовался */
  await page.eval(`${B}.clearStore(); ${B}.HUB.clearLog(); true`);
  await page.eval(`${B}.mountLiveBoth({studentPage: "p2"})`);
  await page.eval(`${B}.waitPage("student", "p2", 5000)`);
  const detached = await page.eval(`(() => ${B}.liveRenderDetached("student", "theory"))()`);
  if (!/STUDENT-SHEET/.test(detached)) throw new Error("live-функция ученика не работает на detached-элементе (нет STUDENT-SHEET): " + String(detached).slice(0, 120));
  try { await page.eval(`${B}.waitChannel("bgreq", 8000)`); }
  catch (e) { throw new Error("учитель не запросил фон у ученика (нет \"bgreq\" в канале): " + e.message); }
  await awaitUnifiedBg(page);
  if (!(await page.eval(`${B}.channelHas("bg")`))) throw new Error("ученик не ответил на bgreq сообщением \"bg\"");
  const th = await bgOf(page, "teacher");
  if (!/STUDENT-SHEET/.test(th)) throw new Error("учитель не получил фон по bgreq");
  if (/TEACHER-KEYS/.test(th)) throw new Error("после bgreq в фоне учителя остался его собственный лист");
  if (page.errors.length) throw new Error("исключения при bgreq: " + page.errors.join(" | ").slice(0, 800));

  /* B) ученика нет вовсе: учитель остаётся на своём live-фоне, без исключений */
  const errsBefore = page.errors.length;
  await page.eval(`${B}.HUB.clearLog(); true`);
  await page.eval(`${B}.mountLiveTeacher()`);
  await page.eval(`${B}.waitChannel("bgreq", 8000)`).catch(() => {});
  await sleep(2200); // дать отработать таймауту запроса (нет ответа)
  const own = await bgOf(page, "teacher");
  if (!/TEACHER-KEYS/.test(own)) throw new Error("без ученика учитель потерял свой live-фон (нет TEACHER-KEYS): " + String(own).slice(0, 160));
  if (/STUDENT-SHEET/.test(own)) throw new Error("без ученика учитель получил чужой фон (STUDENT-SHEET) — неоткуда");
  const src = await bgSourceOf(page, "teacher");
  if (src === "remote") throw new Error("bgSource=remote без ученика");
  const newErrs = page.errors.slice(errsBefore);
  if (newErrs.length) throw new Error("запрос фона без ученика дал исключения: " + newErrs.join(" | ").slice(0, 800));
});

test("G", "Якоря в пустоте: штрих между абзацами остаётся у ближайшего абзаца при сдвиге макета принимающей стороны", async ({ page }) => {
  await fresh(page); // статический лист .sentence с пустым промежутком (margin-bottom:150px)
  const g = await drawStrokeInGap(page, "student", ".sentence", 70, 200);
  const row = await waitStrokeRow(page);
  if (!row || !row.item) throw new Error("штрих не сохранён");
  const a = row.item.a;
  if (!a) throw new Error("штрих в пустом промежутке сохранён без якоря: " + JSON.stringify(row.item).slice(0, 240));
  const nearS = await page.eval(`${B}.elementAtAnchor("student", ${JSON.stringify(a.i)})`);
  if (!nearS) throw new Error("якорь #" + a.i + " не найден на листе ученика");
  /* якорь должен быть к ближайшему абзацу (.sentence / P), а не к корню листа .bd-sheet */
  if (!/sentence/.test(nearS.cls) && nearS.tag !== "P") {
    throw new Error("штрих в пустоте привязан к «" + nearS.tag + "." + nearS.cls + "» вместо ближайшего абзаца .sentence: при сдвиге макета он уедет (anchorAt вернул корень листа)");
  }
  const anchorT = await page.eval(`${B}.elementAtAnchor("teacher", ${JSON.stringify(a.i)})`);
  if (!anchorT) throw new Error("якорь #" + a.i + " не найден на листе учителя");
  /* сдвигаем макет учителя: вставляем абзац в начало листа + refresh/relayout */
  const t0 = await geometry(page, "teacher", ".sentence");
  await page.eval(`(() => {
    const b = ${B}; const r = b.root("teacher"); const sheet = r.querySelector(".bd-bg .bd-sheet");
    if (!sheet) return false;
    const p = document.createElement("p"); p.textContent = "Вставленный абзац для сдвига макета";
    sheet.insertBefore(p, sheet.firstChild); return true;
  })()`);
  await page.eval(`${B}.relayout("teacher")`);
  const t1 = await geometry(page, "teacher", ".sentence");
  const delta = t1.y - t0.y;
  if (!(delta > 20)) throw new Error("макет учителя не сдвинулся вставкой абзаца (ΔY=" + delta.toFixed(1) + " логических px) — проверка невозможна");
  const box = gapBox(g);
  const inkS = await inkAt(page, "student", box);
  /* у учителя ищем краску в полосе, покрывающей и старую, и новую (сдвинутую) позицию */
  const boxT = { x: g.x0 - 40, y: g.y - 90, w: (g.x1 - g.x0) + 80, h: 180 + Math.max(0, delta) + 60 };
  const inkT = await inkAt(page, "teacher", boxT);
  if (!inkS || !inkS.bbox) throw new Error("штрих не нарисовался у ученика в пустом месте: " + JSON.stringify(inkS));
  if (!inkT || !inkT.bbox) throw new Error("у учителя штрих пропал после сдвига макета: " + JSON.stringify(inkT));
  const expY = inkS.bbox.cy + delta;
  if (Math.abs(inkT.bbox.cy - expY) > 10) {
    throw new Error("штрих в пустом месте не привязан к ближайшему абзацу: ожидали y≈" + expY.toFixed(1) + " (позиция ученика " + inkS.bbox.cy.toFixed(1) + " + сдвиг макета " + delta.toFixed(1) + "), фактически y=" + inkT.bbox.cy.toFixed(1) + " (Δ=" + Math.abs(inkT.bbox.cy - expY).toFixed(1) + ")");
  }
  /* и это по-прежнему пустое место (не наехал на текст другого абзаца) */
  const underT = await page.eval(`${B}.elementUnderPoint("teacher", ${inkT.bbox.cx}, ${inkT.bbox.cy})`);
  if (underT && !underT.insideGap) {
    throw new Error("штрих после сдвига оказался на элементе «" + underT.tag + "." + underT.cls + "» (id=" + JSON.stringify(underT.id) + "), а должен остаться в пустом промежутке между абзацами");
  }
  /* и не остался на абсолютном месте, если макет реально уехал */
  if (delta > 30 && Math.abs(inkT.bbox.cy - inkS.bbox.cy) < delta * 0.6) {
    throw new Error("штрих остался на абсолютном месте (y не сдвинулся вместе с абзацем: было " + inkS.bbox.cy.toFixed(1) + ", стало " + inkT.bbox.cy.toFixed(1) + ", сдвиг макета " + delta.toFixed(1) + ")");
  }
});

/* ---------- task-24: H1–H4 (точечный ластик, инлайн-текст, зум/пан, вставка в точку) ---------- */
const sideItems = (page, side) => page.eval(`${B}.items(${JSON.stringify(side)})`);
async function waitSideItems(page, side, pred, label, timeout = 8000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    try { last = await sideItems(page, side); } catch (_) { last = null; }
    if (Array.isArray(last) && pred(last)) return last;
    await sleep(100);
  }
  throw new Error("не дождались items(«" + side + "»): " + label + " (последние: " + JSON.stringify((last || []).slice(-6)).slice(0, 600) + ")");
}
const bcall = (page, side, method, ...args) =>
  page.eval(`(async () => await ${B}.boardCall(${JSON.stringify(side)}, ${JSON.stringify(method)}${args.map(a => ", " + JSON.stringify(a)).join("")}))()`);
const infoSide = (page, side) => page.eval(`${B}.info(${JSON.stringify(side)})`);
const viewSide = (page, side) => page.eval(`${B}.boardView(${JSON.stringify(side)})`);
const inlineSide = (page, side) => page.eval(`${B}.inlineInfo(${JSON.stringify(side)})`);
const scrollSide = (page, side) => page.eval(`${B}.scrollInfo(${JSON.stringify(side)})`);
const itemsOfType = (arr, t) => (arr || []).filter(r => r.item && r.item.t === t);
async function hoverAt(page, side, lx, ly) {
  const p = await page.eval(`${B}.point(${JSON.stringify(side)}, ${JSON.stringify(lx)}, ${JSON.stringify(ly)})`);
  if (!p) return false;
  await page.mouse("mouseMoved", p.x, p.y);
  return true;
}
async function tapScreen(page, x, y) {
  await page.mouse("mouseMoved", x, y);
  await page.mouse("mousePressed", x, y);
  await page.mouse("mouseReleased", x, y);
}
async function tapAt(page, side, lx, ly) {
  const p = await page.eval(`${B}.point(${JSON.stringify(side)}, ${JSON.stringify(lx)}, ${JSON.stringify(ly)})`);
  if (!p) throw new Error("не получили экранную точку для (" + lx + "," + ly + ")");
  await tapScreen(page, p.x, p.y);
  return p;
}
async function waitInline(page, side, timeout = 5000) {
  const t0 = Date.now();
  let inf = null;
  while (Date.now() - t0 < timeout) {
    inf = await inlineSide(page, side);
    if (inf && inf.exists) return inf;
    await sleep(100);
  }
  throw new Error("не появился инлайн-редактор .bd-inline на доске «" + side + "»");
}

test("H1", "Точечный ластик: разбивает один штрих, но не трогает соседний штрих и надпись; надпись — только клик внутри", async ({ page }) => {
  await fresh(page);
  /* две параллельные линии в 12 логических px: радиус точечного ластика ER=7 + полутолщина штриха, поэтому 2–4 px неизбежно задели бы соседнюю; 12 px — «соседняя рядом, но вне радиуса» */
  const y1 = 260, y2 = 272, x0 = 120, x1 = 320;
  await drawStroke(page, "teacher", [[x0, y1], [x0 + 50, y1], [x0 + 100, y1], [x0 + 150, y1], [x1, y1]]);
  await drawStroke(page, "teacher", [[x0, y2], [x0 + 50, y2], [x0 + 100, y2], [x0 + 150, y2], [x1, y2]]);
  await page.eval(`${B}.whenIdle("teacher")`);
  const note = await bcall(page, "teacher", "insertText", "подпись рядом", 600, 60);
  if (!note) throw new Error("insertText не создал надпись рядом (нужна для H1)");
  await page.eval(`${B}.whenIdle("teacher")`);
  const before = await sideItems(page, "teacher");
  const strokes0 = itemsOfType(before, "s");
  const notes0 = itemsOfType(before, "t");
  if (strokes0.length < 2) throw new Error("не нарисовались 2 штриха: " + strokes0.length);
  if (!notes0.length) throw new Error("нет t-надписи перед ластиком");
  const ids0 = new Set(before.map(r => r.id));
  /* проход ластиком по ПЕРВОМУ штриху: точка берётся с учётом якорного сдвига (штрих мог сместиться после вставки надписи) */
  await page.eval(`${B}.setTool("teacher","erase")`);
  let cur = await page.eval(`${B}.currentTool("teacher")`);
  if (cur !== "erase") { await page.eval(`${B}.clickButton("teacher", /ластик/i)`); await sleep(150); cur = await page.eval(`${B}.currentTool("teacher")`); }
  if (cur !== "erase") throw new Error("не включился точечный ластик (data-tool=erase), текущий инструмент: " + cur);
  const ep = await page.eval(`(() => {
    const b = ${B}; const dbg = b.debug("teacher");
    const it = dbg.raw.filter(r => r.item && r.item.t === "s").sort((a, c) => +a.id - +c.id)[0];
    if (!it) return null;
    const a = it.item.a, box = a ? (dbg.anchorBoxes || []).find(x => x.i === +a.i) : null;
    const sh = box ? [box.x - a.ox, box.y - a.oy] : [0, 0];
    const mid = it.item.p[Math.floor(it.item.p.length / 2)];   // середина штриха, чтобы стереть кусок и получить 2 куска
    return { x: mid[0] + sh[0], y: mid[1] + sh[1], shift: sh };
  })()`);
  if (!ep) throw new Error("не нашли первый штрих для ластика");
  const epScr = await page.eval(`${B}.point("teacher", ${JSON.stringify(ep.x)}, ${JSON.stringify(ep.y)})`);
  await page.drag(epScr.x - 3, epScr.y, epScr.x + 3, epScr.y, 4);
  await page.eval(`${B}.whenIdle("teacher")`);
  const after = await waitSideItems(page, "teacher", arr => itemsOfType(arr, "s").some(r => !ids0.has(r.id)), "появились куски стёртого штриха");
  const ids1 = new Set(after.map(r => r.id));
  const newStrokes = itemsOfType(after, "s").filter(r => !ids0.has(r.id));
  if (!(newStrokes.length >= 2)) throw new Error("после точечного ластика нет 2 кусков штриха: новых " + newStrokes.length);
  if ([strokes0[0].id, strokes0[1].id].every(id => ids1.has(id))) throw new Error("старый штрих не удалён/не разбит: ids не изменились");
  /* соседний (второй) штрих цел */
  const secondNow = after.find(r => r.id === strokes0[1].id);
  if (!secondNow) throw new Error("соседний штрих исчез — ластик задел соседнюю линию");
  if ((secondNow.item.p || []).length !== (strokes0[1].item.p || []).length) throw new Error("соседний штрих изменился: " + JSON.stringify(secondNow.item.p));
  /* надпись цела после ластика по штриху */
  if (!after.some(r => r.id === notes0[0].id)) throw new Error("надпись исчезла после ластика по штриху");
  /* клик ластиком рядом с надписью — не удаляет */
  const npt = await page.eval(`${B}.point("teacher", 600, 60)`);
  await tapScreen(page, npt.x + 160, npt.y + 90);
  await page.eval(`${B}.whenIdle("teacher")`);
  let after2 = await sideItems(page, "teacher");
  if (!after2.some(r => r.id === notes0[0].id)) throw new Error("ластик рядом с надписью удалил её (должен только внутри)");
  /* клик ВНУТРИ надписи — удаляет */
  const npt2 = await page.eval(`${B}.point("teacher", 620, 68)`);
  await tapScreen(page, npt2.x, npt2.y);
  await page.eval(`${B}.whenIdle("teacher")`);
  after2 = await sideItems(page, "teacher");
  if (after2.some(r => r.id === notes0[0].id)) throw new Error("клик ластиком внутри надписи не удалил её");
});

test("H2", "Инлайн-текст: .bd-inline в точке, авто-размер, hover-ручка-перетаскивание и resize, Enter → объект t; remount", async ({ page }) => {
  await fresh(page);
  await page.eval(`${B}.setTool("teacher","text")`);
  await tapAt(page, "teacher", 200, 320);
  let inf = await waitInline(page, "teacher");
  if (await page.eval(`!!document.querySelector("#bd-teacher .bd-editor:not(.bd-inline)")`)) throw new Error("открылся старый большой .bd-editor вместо инлайн .bd-inline");
  const w0 = inf.logical && inf.logical.w, h0 = inf.logical && inf.logical.h;
  /* авто-размер: длинная строка должна увеличить окошко (не фикс 140×70) */
  await page.eval(`${B}.inlineType("teacher", ${JSON.stringify("Длинная надпись для проверки авто-размера инлайн-редактора")})`);
  await sleep(250);
  inf = await waitInline(page, "teacher");
  const w1 = inf.logical && inf.logical.w;
  if (!(w1 > w0 + 10)) throw new Error("инлайн-редактор не вырос по ширине (авто-размер): " + w0 + " → " + w1);
  /* hover: ручка-перетаскивание появляется */
  await page.mouse("mouseMoved", inf.box.cx, inf.box.cy);
  await sleep(150);
  inf = await waitInline(page, "teacher");
  if (!inf.drag) throw new Error("нет ручки-перетаскивания .bd-inline-drag");
  if (!inf.dragVisible) throw new Error("ручка .bd-inline-drag не видна при наведении (opacity)");
  /* таскаем окошко за ручку */
  const beforeX = inf.logical.x, beforeY = inf.logical.y, dragPt = { x: inf.drag.cx, y: inf.drag.cy };
  await page.drag(dragPt.x, dragPt.y, dragPt.x + 60, dragPt.y + 40, 6);
  await sleep(200);
  inf = await waitInline(page, "teacher");
  if (!(inf.logical.x > beforeX + 15 && inf.logical.y > beforeY + 8)) throw new Error("ручка .bd-inline-drag не таскает окошко: (" + beforeX + "," + beforeY + ") → (" + inf.logical.x + "," + inf.logical.y + ")");
  /* resize за угол */
  if (!inf.resize) throw new Error("нет ручки resize (.bd-inline-resize/.bd-editor-handle)");
  const wBefore = inf.logical.w, rp = { x: inf.resize.cx, y: inf.resize.cy };
  await page.drag(rp.x, rp.y, rp.x + 70, rp.y + 50, 6);
  await sleep(200);
  inf = await waitInline(page, "teacher");
  if (!(inf.logical.w > wBefore + 10)) throw new Error("resize за угол не изменил ширину: " + wBefore + " → " + inf.logical.w);
  /* Enter — сохранить */
  await page.eval(`(() => { const i = ${B}.inlineInfo("teacher"); i.ta.focus(); i.ta.value = "Длинная надпись для проверки авто-размера инлайн-редактора"; i.ta.dispatchEvent(new Event("input", {bubbles:true})); return true; })()`);
  await page.key("Enter");
  const items = await waitSideItems(page, "teacher", arr => itemsOfType(arr, "t").length > 0, "объект t после Enter");
  const tItems = itemsOfType(items, "t");
  const item = tItems[tItems.length - 1].item;
  if (!/Длинная надпись/.test(item.s || "")) throw new Error("объект t не содержит введённый текст: " + JSON.stringify(item.s));
  if (!(item.w >= 110 && item.w <= 470 && item.h >= 20 && item.h <= 320)) throw new Error("w/h не авто-размер (ожидали 110..470 × 20..320): " + JSON.stringify({ w: item.w, h: item.h }));
  if (Math.abs(item.x - 200) > 60 || Math.abs(item.y - 320) > 90) throw new Error("объект t не в районе точки клика (с учётом перетаскивания): " + JSON.stringify({ x: item.x, y: item.y }));
  /* remount — надпись жива */
  await page.eval(`${B}.remountReady("teacher")`);
  await waitSideItems(page, "teacher", arr => itemsOfType(arr, "t").some(r => String(r.item.s || "").includes("Длинная надпись")), "надпись после remount", 10000);
});

test("H3", "Зум/пан/расширение: кнопки и колесо меняют info().zoom, scroll/hand-drag работают, «Расширить» растит height, рисование после зума — в логических координатах", async ({ page }) => {
  await fresh(page);
  const info0 = await infoSide(page, "teacher");
  if (info0.zoom == null) throw new Error("в info() нет zoom (board.js без task-23?)");
  const z0 = +info0.zoom;
  if (!(await page.eval(`${B}.clickZoom("teacher","in")`))) throw new Error("нет кнопки [data-zoom=in]");
  await sleep(200);
  const z1 = +(await infoSide(page, "teacher")).zoom;
  if (!(z1 > z0 + 0.01)) throw new Error("кнопка «+» не увеличила zoom: " + z0 + " → " + z1);
  await page.eval(`${B}.clickZoom("teacher","reset")`); await sleep(200);
  const zr = +(await infoSide(page, "teacher")).zoom;
  if (Math.abs(zr - 1) > 0.02) throw new Error("кнопка «100%» не даёт zoom=1: " + zr);
  await page.eval(`${B}.clickZoom("teacher","out")`); await sleep(200);
  if (!(+(await infoSide(page, "teacher")).zoom < zr - 0.01)) throw new Error("кнопка «−» не уменьшила zoom");
  await page.eval(`${B}.clickZoom("teacher","fit")`); await sleep(200);
  const zf = +(await infoSide(page, "teacher")).zoom;
  if (!(zf > 0.2)) throw new Error("кнопка «По ширине» не сработала: zoom=" + zf);
  await page.eval(`${B}.fitWidth("teacher")`); await sleep(150);
  const zb = +(await infoSide(page, "teacher")).zoom;
  await page.eval(`${B}.wheelBoard("teacher", {deltaY: -240, ctrlKey: true})`);
  await sleep(250);
  const za = +(await infoSide(page, "teacher")).zoom;
  if (!(za > zb + 0.01)) throw new Error("Ctrl+wheel не зумит: " + zb + " → " + za);
  /* scroll + info().scrollY */
  await page.eval(`${B}.fitWidth("teacher")`); await sleep(150);
  const si = await scrollSide(page, "teacher");
  if (!si) throw new Error("нет скроллируемого контейнера доски (.bd-stage)");
  await page.eval(`${B}.setScroll("teacher", {top: 120})`); await sleep(150);
  const infoS = await infoSide(page, "teacher");
  if (!(infoS.scrollY > 50)) throw new Error("scrollTop не отражается в info().scrollY: " + JSON.stringify({ scrollY: infoS.scrollY }));
  /* hand-drag прокручивает */
  await page.eval(`${B}.setScroll("teacher", {top: 0})`);
  await page.eval(`${B}.setTool("teacher","hand")`);
  const sc0 = +(await infoSide(page, "teacher")).scrollY || 0;
  const p0 = await page.eval(`${B}.point("teacher", 400, 500)`);
  await page.drag(p0.x, p0.y, p0.x, p0.y - 200, 8);
  await sleep(300);
  const sc1 = +(await infoSide(page, "teacher")).scrollY || 0;
  if (!(sc1 > sc0 + 50)) throw new Error("hand-drag не прокрутил доску: " + sc0 + " → " + sc1);
  /* «Расширить лист» */
  const h0 = +(await infoSide(page, "teacher")).height;
  if (!(await page.eval(`${B}.extendBoard("teacher")`))) throw new Error("нет кнопки «Расширить лист» ([data-act=extend])");
  await sleep(250);
  const h1 = +(await infoSide(page, "teacher")).height;
  if (!(h1 > h0)) throw new Error("«Расширить лист» не увеличил info().height: " + h0 + " → " + h1);
  /* рисование после зума: lastPoint и штрих — в логических координатах */
  await page.eval(`${B}.fitWidth("teacher")`); await sleep(150);
  await page.eval(`${B}.setZoom("teacher", 1.6)`); await sleep(250);
  await page.eval(`${B}.setTool("teacher","pen")`);
  await tapAt(page, "teacher", 300, 400);
  await page.eval(`${B}.whenIdle("teacher")`);
  const lp = await page.eval(`${B}.lastPoint("teacher")`);
  if (!lp) throw new Error("lastPoint() пуст после клика при zoom=1.6");
  if (Math.abs(lp.x - 300) > 8 || Math.abs(lp.y - 400) > 8) throw new Error("lastPoint не совпал с логической точкой клика при zoom=1.6: " + JSON.stringify(lp));
  const arr = await sideItems(page, "teacher");
  const stroke = itemsOfType(arr, "s").pop();
  if (stroke && (Math.abs(stroke.item.p[0][0] - 300) > 8 || Math.abs(stroke.item.p[0][1] - 400) > 8)) throw new Error("штрих после зума не в логических координатах: " + JSON.stringify(stroke.item.p[0]));
});

test("H5", "Отмена/возврат: случайно удалённое объект возвращается (↶), ↷ снова удаляет; вторая сторона видит", async ({ page }) => {
  await fresh(page);
  const rec = await bcall(page, "teacher", "insertText", "H5 удалить меня", 200, 300);
  if (!rec || !rec.id) throw new Error("insertText не вернул объект");
  await page.eval(`${B}.whenIdle("teacher")`);
  const has = a => itemsOfType(a, "t").some(r => r.item.s === "H5 удалить меня");
  await waitSideItems(page, "teacher", has, "текст H5 на доске");
  await bcall(page, "teacher", "select", rec.id);
  await bcall(page, "teacher", "deleteSelected");
  await page.eval(`${B}.whenIdle("teacher")`);
  await waitSideItems(page, "teacher", a => !has(a), "текст H5 удалён");
  await bcall(page, "teacher", "undo");
  await page.eval(`${B}.whenIdle("teacher")`);
  await waitSideItems(page, "teacher", has, "после ↶ удалённый текст вернулся");
  await waitSideItems(page, "student", has, "вернувшийся текст виден второй стороне");
  await bcall(page, "teacher", "redo");
  await page.eval(`${B}.whenIdle("teacher")`);
  await waitSideItems(page, "teacher", a => !has(a), "после ↷ текст снова удалён");
  await bcall(page, "teacher", "undo");
  await page.eval(`${B}.whenIdle("teacher")`);
  await waitSideItems(page, "teacher", has, "второй ↶ снова вернул текст");
});

test("H6", "Вид ведущего: getRelView у учителя → setView у ученика даёт тот же относительный масштаб и место (экраны разной ширины)", async ({ page }) => {
  await fresh(page);
  await bcall(page, "teacher", "setZoom", 1.6);
  await bcall(page, "teacher", "extendHeight", 2000);
  const tv = await bcall(page, "teacher", "getRelView");
  if (!tv || tv.fit || !(tv.z > 1.2)) throw new Error("getRelView учителя: " + JSON.stringify(tv));
  await bcall(page, "student", "extendHeight", 2000);
  await bcall(page, "student", "setView", {fit: false, z: tv.z, x: 0, y: 120});
  const sv = await bcall(page, "student", "getRelView");
  if (Math.abs(sv.z - tv.z) > 0.05) throw new Error("относительный масштаб ученика не совпал: " + JSON.stringify({tv, sv}));
  if (Math.abs(sv.y - 120) > 8) throw new Error("место (y) ученика не совпало: " + JSON.stringify(sv));
  await bcall(page, "student", "setView", {fit: true, y: 0});
  const sf = await bcall(page, "student", "getRelView");
  if (!sf.fit) throw new Error("setView fit:true не включил режим «по ширине»: " + JSON.stringify(sf));
});

test("H7", "Сверка с базой: запись, попавшая в базу без живого события, появляется у второй стороны сама (≤ 9 c)", async ({ page }) => {
  await fresh(page);
  const have = a => itemsOfType(a, "t").some(r => r.item.s === "H7 только в базе");
  const cur = await page.eval(`${B}.currentPage("student")`);
  await page.eval(`(() => { const rows = ${B}.dump(${JSON.stringify(cur)}); rows.push({id: 9001, item: {t:"t", x:220, y:360, s:"H7 только в базе", c:"#111", w:300}}); ${B}.seed(${JSON.stringify(cur)}, rows); return true; })()`);
  await waitSideItems(page, "student", have, "запись из базы без события появилась сама", 9500);
});

test("H8", "Мгновенно: объект виден второй стороне раньше, чем сохранился в базе (база медленная, 1.5 c)", async ({ page }) => {
  await fresh(page);
  await page.eval(`(() => { const api = ${B}.api, orig = api.add; api.add = async (p, it) => { await ${B}.sleep(1500); return orig(p, it); }; return true; })()`);
  const have = a => itemsOfType(a, "t").some(r => r.item.s === "H8 мгновенно");
  const t0 = Date.now();
  bcall(page, "teacher", "insertText", "H8 мгновенно", 240, 380);
  await waitSideItems(page, "student", have, "объект у ученика до записи в базу", 900);
  const dt = Date.now() - t0;
  if (dt > 1000) throw new Error("доставка заняла " + dt + " мс – дожидалась базы");
  await sleep(1900);
  await waitSideItems(page, "student", a => itemsOfType(a, "t").filter(r => r.item.s === "H8 мгновенно").length === 1, "после записи в базу – ровно один экземпляр у ученика");
});

test("H4", "Вставка в точку: paste текста/картинки и API insertText/insertImage/insertPage — объект в точке клика и виден второй стороне", async ({ page, fixtures }) => {
  await fresh(page);
  /* клик по холсту запоминает lastPoint */
  await page.eval(`${B}.setTool("teacher","pen")`);
  await tapAt(page, "teacher", 520, 520);
  await page.eval(`${B}.whenIdle("teacher")`);
  const lp = await page.eval(`${B}.lastPoint("teacher")`);
  if (!lp) throw new Error("lastPoint() пуст после клика по доске (H4)");
  /* paste текста → .bd-inline в lastPoint, Enter → t-объект рядом */
  const pasteText = "Вставка из буфера";
  await page.eval(`${B}.pasteBoard("teacher", {text: ${JSON.stringify(pasteText)}})`);
  const inf = await waitInline(page, "teacher");
  if (!String(inf.value || "").includes(pasteText)) throw new Error("текст из paste не попал в .bd-inline: " + JSON.stringify(inf.value));
  await page.eval(`${B}.inlineInfo("teacher").ta.focus(); true`);
  await page.key("Enter");
  let arr = await waitSideItems(page, "teacher", a => itemsOfType(a, "t").some(r => String(r.item.s || "").includes(pasteText)), "t-объект после paste текста");
  const tItem = itemsOfType(arr, "t").find(r => String(r.item.s || "").includes(pasteText)).item;
  if (Math.abs(tItem.x - lp.x) > 20 || Math.abs(tItem.y - lp.y) > 20) throw new Error("вставленный текст не в точке последнего клика: " + JSON.stringify({ item: { x: tItem.x, y: tItem.y }, lp }));
  /* API insertText / insertImage в точку */
  const note = await bcall(page, "teacher", "insertText", "API-текст", 150, 700);
  if (!note) throw new Error("insertText(text, x, y) не вернул объект");
  const img = await bcall(page, "teacher", "insertImage", "data:image/png;base64," + fixtures.files.image1.b64, 350, 720);
  if (!img) throw new Error("insertImage(url, x, y) не вернул объект");
  await page.eval(`${B}.whenIdle("teacher")`);
  arr = await sideItems(page, "teacher");
  const apiT = itemsOfType(arr, "t").find(r => r.item.s === "API-текст");
  const apiI = itemsOfType(arr, "i").find(r => String(r.item.src || "").startsWith("data:image/png"));
  if (!apiT || Math.abs(apiT.item.x - 150) > 3 || Math.abs(apiT.item.y - 700) > 3) throw new Error("insertText не встал в (150,700): " + JSON.stringify(apiT && apiT.item));
  if (!apiI || Math.abs(apiI.item.x - 350) > 3 || Math.abs(apiI.item.y - 720) > 3) throw new Error("insertImage не встал в (350,720): " + JSON.stringify(apiI && apiI.item));
  await waitSideItems(page, "student", a => itemsOfType(a, "t").some(r => r.item.s === "API-текст") && itemsOfType(a, "i").length > 0, "вставки из API видны второй стороне");
  /* paste картинки — в lastPoint */
  await page.eval(`${B}.setTool("teacher","pen")`);
  await tapAt(page, "teacher", 200, 640);
  await page.eval(`${B}.whenIdle("teacher")`);
  const lp2 = await page.eval(`${B}.lastPoint("teacher")`);
  const imgsBefore = itemsOfType(await sideItems(page, "teacher"), "i").length;
  await page.eval(`${B}.pasteBoard("teacher", {b64: ${JSON.stringify(fixtures.files.image2.b64)}, type: "image/png", name: "paste.png"})`);
  const pasted = await waitSideItems(page, "teacher", a => itemsOfType(a, "i").length > imgsBefore, "картинка из paste-буфера появилась", 6000);
  /* paste на document слышат ОБЕ доски стенда: проверяем, что картинка появилась в точке lastPoint кликнувшей (teacher) стороны */
  const nearImg = itemsOfType(pasted, "i").find(r => Math.abs(r.item.x - lp2.x) <= 20 && Math.abs(r.item.y - lp2.y) <= 20);
  if (!nearImg) {
    const imgs = itemsOfType(pasted, "i").map(r => ({ x: r.item.x, y: r.item.y }));
    throw new Error("картинка из paste не в точке клика: " + JSON.stringify({ imgs, lp: lp2 }));
  }
  /* insertPage открывает новый лист (board-dev: open + broadcast) */
  const key = await bcall(page, "teacher", "insertPage", "API-лист", "<div class='bd-sheet'><p>Лист из API</p></div>", true);
  if (!key) throw new Error("insertPage не вернул ключ листа");
  await page.eval(`${B}.whenIdle("teacher")`);
  const tInfo = await infoSide(page, "teacher");
  if (tInfo.page !== key) throw new Error("insertPage не открыл новый лист: page=" + tInfo.page + ", key=" + key);
  const keys = await page.eval(`${B}.pageKeys("teacher")`);
  if (!keys.includes(key)) throw new Error("нового листа нет в списке листов: " + JSON.stringify(keys));
  if (!(tInfo.pages || []).some(p => p.key === key)) throw new Error("insertPage не добавил лист в info().pages");
});

/* ---------- task-27: I1–I3 (выделение, удаление, размер картинки/текста) ---------- */
const selOf = (page, side) => page.eval(`${B}.selInfo(${JSON.stringify(side)})`);
const selectItem = (page, side, id) => page.eval(`${B}.selectObj(${JSON.stringify(side)}, ${JSON.stringify(String(id))})`);
const clickSel = (page, side, action) => page.eval(`${B}.clickSel(${JSON.stringify(side)}, ${JSON.stringify(action)})`);
const menuClickRe = (page, re) => page.eval(`${B}.menuClick(new RegExp(${JSON.stringify(re)}))`);
const ctxMenu = (page, side, lx, ly) => page.eval(`${B}.contextMenu(${JSON.stringify(side)}, ${JSON.stringify(lx)}, ${JSON.stringify(ly)})`);
const itemById = (arr, id) => (arr || []).find(r => String(r.id) === String(id));
/** id последнего элемента типа t (insertImage/insertText возвращают item без id — id присваивает api.add) */
async function latestId(page, side, t, pred) {
  const arr = await sideItems(page, side);
  const rows = itemsOfType(arr, t).filter(r => !pred || pred(r.item));
  if (!rows.length) throw new Error("не нашли на доске «" + side + "» элемент t:" + t + " после вставки");
  return rows[rows.length - 1].id;
}
async function waitNoItem(page, side, id, label, timeout = 8000) {
  const t0 = Date.now(); let arr = [];
  while (Date.now() - t0 < timeout) {
    try { arr = await sideItems(page, side); } catch (_) { arr = []; }
    if (!itemById(arr, id)) return true;
    await sleep(100);
  }
  throw new Error("элемент " + id + " не исчез у «" + side + "»: " + label + " :: " + JSON.stringify((arr || []).map(r => ({ id: r.id, t: r.item && r.item.t }))).slice(0, 400));
}
async function pressBoardKey(page, key) {
  await page.eval(`(() => { try { document.body.focus(); } catch (_) {} const a = document.activeElement; if (a && a !== document.body && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return false; return true; })()`);
  await page.key(key, key);
}
async function dragSelResize(page, side, dx, dy, steps = 12) {
  const inf = await selOf(page, side);
  if (!inf.resize) throw new Error("нет ручки .bd-sel-resize у выделенного объекта («" + side + "»)");
  await page.drag(inf.resize.cx, inf.resize.cy, inf.resize.cx + dx, inf.resize.cy + dy, steps);
  await page.eval(`${B}.whenIdle(${JSON.stringify(side)})`);
  await sleep(150);
  return await selOf(page, side);
}
test("I1", "Выделение+удаление: Delete/Backspace, кнопка [data-sel=del] и контекстное меню «Удалить» (картинка и надпись, обе стороны)", async ({ page, fixtures }) => {
  await fresh(page);
  const url = "data:image/png;base64," + fixtures.files.image1.b64;
  /* 1) Delete по клавише */
  const imgItem = await bcall(page, "teacher", "insertImage", url, 160, 160);
  if (!imgItem) throw new Error("insertImage не вернул объект");
  await page.eval(`${B}.whenIdle("teacher")`);
  const img1 = await latestId(page, "teacher", "i");
  await selectItem(page, "teacher", img1);
  await sleep(150);
  let s = await selOf(page, "teacher");
  if (!s.exists) throw new Error("после select(id) нет рамки .bd-selbox");
  if (!s.bar) throw new Error("после select(id) нет панели .bd-sel-bar");
  if (!s.selected || String(s.selected.id) !== String(img1)) throw new Error("info().selected не совпал с select(id): " + JSON.stringify(s.selected));
  await pressBoardKey(page, "Delete");
  await waitNoItem(page, "teacher", img1, "Delete");
  await waitNoItem(page, "student", img1, "Delete у второй стороны");
  /* 2) кнопка 🗑 [data-sel=del] */
  await bcall(page, "teacher", "insertImage", url, 260, 200);
  await page.eval(`${B}.whenIdle("teacher")`);
  const img2 = await latestId(page, "teacher", "i");
  await selectItem(page, "teacher", img2); await sleep(150);
  if (!(await clickSel(page, "teacher", "del"))) throw new Error("нет кнопки [data-sel=del] в .bd-sel-bar");
  await waitNoItem(page, "teacher", img2, "кнопка 🗑");
  await waitNoItem(page, "student", img2, "кнопка 🗑 у второй стороны");
  /* 3) контекстное меню «Удалить» */
  await bcall(page, "teacher", "insertImage", url, 360, 240);
  await page.eval(`${B}.whenIdle("teacher")`);
  const img3 = await latestId(page, "teacher", "i");
  const one = itemById(await sideItems(page, "teacher"), img3);
  if (!one) throw new Error("картинки нет в items после вставки");
  await ctxMenu(page, "teacher", (+one.item.x || 0) + 40, (+one.item.y || 0) + 40);
  await sleep(250);
  const menu = await page.eval(`${B}.menuInfo()`);
  if (!menu.items.length) throw new Error("после contextmenu не появилось меню (0 пунктов)");
  const res = await menuClickRe(page, "удал");
  if (!res.ok) throw new Error("в контекстном меню нет «Удалить»: " + JSON.stringify(res.items));
  await waitNoItem(page, "teacher", img3, "контекстное меню «Удалить»");
  /* 4) надпись по Backspace */
  await bcall(page, "teacher", "insertText", "Удаляемая надпись", 180, 320);
  await page.eval(`${B}.whenIdle("teacher")`);
  const tid = await latestId(page, "teacher", "t", it => String(it.s || "").includes("Удаляемая надпись"));
  await selectItem(page, "teacher", tid); await sleep(150);
  await page.eval(`(() => { try { document.body.focus(); } catch (_) {} return true; })()`);
  await page.key("Backspace", "Backspace");
  await waitNoItem(page, "teacher", tid, "Backspace (надпись)");
  if ((await selOf(page, "teacher")).exists) throw new Error("после удаления .bd-selbox/панель не исчезли");
});
test("I2", "Ресайз картинки за .bd-sel-resize: w/h меняются с пропорциями, reset, remount и вторая сторона", async ({ page, fixtures }) => {
  await fresh(page);
  const url = "data:image/png;base64," + fixtures.files.image1.b64;
  const img = await bcall(page, "teacher", "insertImage", url, 150, 180);
  if (!img) throw new Error("insertImage не вернул объект");
  await page.eval(`${B}.whenIdle("teacher")`);
  const imgId = await latestId(page, "teacher", "i");
  await selectItem(page, "teacher", imgId); await sleep(180);
  const before = itemById(await sideItems(page, "teacher"), imgId);
  const bw = +(before.item.w || 0), bh = +(before.item.h || 0);
  if (!(bw > 0 && bh > 0)) throw new Error("у картинки нет w/h: " + JSON.stringify(before.item));
  await dragSelResize(page, "teacher", 130, 70);
  let cur = itemsOfType(await sideItems(page, "teacher"), "i")[0];
  if (!cur) throw new Error("картинка исчезла после ресайза");
  const nw = +cur.item.w, nh = +cur.item.h;
  if (!(nw > bw + 20 && nh > bh + 10)) throw new Error("ресайз за угол не увеличил w/h: " + JSON.stringify({ bw, bh, nw, nh }));
  const r0 = bw / bh, r1 = nw / nh;
  if (Math.abs(r1 - r0) / r0 > 0.25) throw new Error("пропорции картинки сильно сломались: " + r0.toFixed(3) + " → " + r1.toFixed(3));
  await waitSideItems(page, "student", a => { const x = itemsOfType(a, "i")[0]; return x && +x.item.w > bw + 20; }, "вторая сторона видит новый w");
  /* reset возвращает исходный размер */
  const sel1 = await selOf(page, "teacher");
  if (sel1.selected && sel1.selected.id != null) await selectItem(page, "teacher", sel1.selected.id);
  if (!(await clickSel(page, "teacher", "reset"))) throw new Error("нет кнопки [data-sel=reset] у картинки");
  await page.eval(`${B}.whenIdle("teacher")`); await sleep(250);
  const reset = itemsOfType(await sideItems(page, "teacher"), "i")[0];
  if (!reset) throw new Error("картинка исчезла после reset");
  if (Math.abs(+reset.item.w - bw) > 20) throw new Error("reset не вернул исходную ширину: было " + bw + ", стало " + reset.item.w);
  /* увеличиваем и проверяем сохранение после remount + у второй стороны */
  await selectItem(page, "teacher", reset.id); await sleep(150);
  await dragSelResize(page, "teacher", 110, 55);
  const big = itemsOfType(await sideItems(page, "teacher"), "i")[0];
  const bigW = +big.item.w;
  await page.eval(`${B}.remountReady("teacher")`);
  const saved = itemsOfType(await waitSideItems(page, "teacher", a => itemsOfType(a, "i").length > 0, "картинка после remount"), "i")[0];
  if (Math.abs(+saved.item.w - bigW) > 3) throw new Error("после remount w не сохранился: " + bigW + " → " + saved.item.w);
  const onStudent = itemsOfType(await waitSideItems(page, "student", a => itemsOfType(a, "i").length > 0, "картинка у второй стороны"), "i")[0];
  if (!onStudent || Math.abs(+onStudent.item.w - bigW) > 3) throw new Error("вторая сторона не видит сохранённый размер: " + JSON.stringify(onStudent && onStudent.item));
});
test("I3", "Текст: A+/A− меняют sz и высоту, resize за угол — w, reset = sz 22, sz сохраняется после remount", async ({ page }) => {
  await fresh(page);
  const t = await bcall(page, "teacher", "insertText", "Текст для проверки размера и шрифта", 180, 260);
  if (!t) throw new Error("insertText не вернул объект");
  await page.eval(`${B}.whenIdle("teacher")`); await sleep(150);
  const tId = await latestId(page, "teacher", "t");
  await selectItem(page, "teacher", tId); await sleep(180);
  let s = await selOf(page, "teacher");
  if (!s.selected) throw new Error("info().selected пуст после select текста");
  const sz0 = +(s.selected.sz || 0) || 22;
  if (!(await clickSel(page, "teacher", "plus"))) throw new Error("нет кнопки [data-sel=plus] для текста");
  await page.eval(`${B}.whenIdle("teacher")`); await sleep(200);
  let s1 = await selOf(page, "teacher");
  let it1 = itemsOfType(await sideItems(page, "teacher"), "t")[0];
  if (!(+((s1.selected || {}).sz || 0) > sz0)) throw new Error("A+ не увеличил sz: было " + sz0 + ", selected=" + JSON.stringify(s1.selected));
  const h1 = +it1.item.h || 0;
  await clickSel(page, "teacher", "plus"); await page.eval(`${B}.whenIdle("teacher")`); await sleep(200);
  let s2 = await selOf(page, "teacher");
  let it2 = itemsOfType(await sideItems(page, "teacher"), "t")[0];
  if (!(+((s2.selected || {}).sz || 0) > +((s1.selected || {}).sz || 0))) throw new Error("второй A+ не увеличил sz");
  if (!(+it2.item.h >= h1)) throw new Error("высота текста не выросла вместе с sz: " + h1 + " → " + it2.item.h);
  await clickSel(page, "teacher", "minus"); await page.eval(`${B}.whenIdle("teacher")`); await sleep(200);
  let s3 = await selOf(page, "teacher");
  if (!(+((s3.selected || {}).sz || 0) < +((s2.selected || {}).sz || 0))) throw new Error("A− не уменьшил sz");
  /* resize за угол меняет ширину */
  const beforeW = +(itemsOfType(await sideItems(page, "teacher"), "t")[0].item.w || 0);
  await dragSelResize(page, "teacher", 90, 45);
  const widened = +(itemsOfType(await sideItems(page, "teacher"), "t")[0].item.w || 0);
  if (!(widened > beforeW + 15)) throw new Error("resize за угол не изменил ширину текста: " + beforeW + " → " + widened);
  /* reset: sz = 22 */
  if (!(await clickSel(page, "teacher", "reset"))) throw new Error("нет кнопки [data-sel=reset] для текста");
  await page.eval(`${B}.whenIdle("teacher")`); await sleep(250);
  const s4 = await selOf(page, "teacher");
  if (Math.abs(+((s4.selected || {}).sz || 0) - 22) > 1) throw new Error("reset не вернул sz=22: " + JSON.stringify(s4.selected));
  /* sz сохраняется после remount */
  const cur = itemsOfType(await sideItems(page, "teacher"), "t")[0];
  await selectItem(page, "teacher", cur.id); await sleep(150);
  await clickSel(page, "teacher", "plus"); await page.eval(`${B}.whenIdle("teacher")`); await sleep(200);
  const wantSz = +((await selOf(page, "teacher")).selected.sz || 0);
  await page.eval(`${B}.remountReady("teacher")`);
  const after = itemsOfType(await waitSideItems(page, "teacher", a => itemsOfType(a, "t").length > 0, "текст после remount"), "t")[0];
  if (Math.abs(+(after.item.sz || 22) - wantSz) > 1) throw new Error("sz не сохранился после remount: " + wantSz + " → " + (after.item.sz || 22));
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
    console.log("\nИтог по доске v55: " + (results.length - failed) + "/" + results.length + " PASS" + (failed ? ", " + failed + " FAIL" : "") +
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
