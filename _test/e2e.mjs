/* E2E-проверки repetitor v57 без npm и без сети (Node 22+, глобальный WebSocket, Chrome).
   Сценарии:
     a) ученик на предмете B, учитель начинает урок предмета A → ученик сам переключается
        на предмет A, видит материал урока без перезагрузки; у учителя «онлайн», а не «не в сети»;
     b1) смена урока в комнате → у ученика новый материал < 2 c без перезагрузки;
     b2) урок из другого предмета (учитель открывает урок B, когда ученик в комнате на A)
         → ученик переключается и видит материал < 4 c без перезагрузки;
     b3) refresh в комнате → тост «Материалы обновились», доска не сбрасывается, без перезагрузки;
     Q1) учитель собрал тест по темам → строка в topic_quizzes, ссылка ?quiz=, кнопка «Открыть у ученика»
         отправляет live cmd type "quiz";
     Q2) ручное «пройдено»: covered + covered_manual, колонка «Выполнено» не меняется, снятие;
     Q3) ученик проходит тест по прямой ссылке: неверно → объяснение + повтор, повторно неверно →
         «Дальше» и тема needs_work; финиш .quiz-result + rpc quiz_submit;
     Q4) карта тем у учителя (#qz-map .qz-topic.bad) и у ученика (раздел «Тесты»);
     S1) самообучение, блок ударений: ошибка → подсказка/повтор, 15/15; works self:stress + result kind self;
     S2) ошибка возвращает слово (+2 повтора), оно не освоено и попадает в errors (Play.stressState);
     S3) карточки: «Показать ответ» → «Знаю»/«Ещё учить» (возврат карточки) до всех карточек;
         works self:deck + result kind self (self:cards);
     S4) «Мои ошибки» собираются из ошибок тренажёров, проход уменьшает items; прогресс подхватывается
         после перезагрузки; блок «Что подтянуть» (.self-prep).
   Доска в реальном приложении проверяется отдельно стендом _test/board.mjs (board.html).

   Запуск: node _test/e2e.mjs            (headless)
           E2E_HEADLESS=0 node _test/e2e.mjs
           E2E_ONLY=a,b1,Q1 node _test/e2e.mjs    (S1–S4 можно гонять отдельно: E2E_ONLY=S)
   Мок Supabase внедряется до скриптов страницы (addScriptToEvaluateOnNewDocument).
   Порты: 8766 (статика) / 9334 (CDP), чтобы не пересекаться с board.mjs (8765/9333).
   Если порт занят другим прогоном — задайте PORT/CDP_PORT (иначе можно подключиться к чужому Chrome
   и получить серию «CDP timeout: Runtime.evaluate»). */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";
import { startServer, REPO_ROOT } from "./serve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(__dirname, "artifacts");
const MOCK_SRC = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");
const PORT = +(process.env.PORT || 8766);
const CDP_PORT = +(process.env.CDP_PORT || 9334);

/* ================= данные: учитель, две строки ученика (два предмета), курсы ================= */
const TEACHER_ID = "t-1001";
const PERSON_ID = "person-1";
const ROW_A = "rowA"; // русский
const ROW_B = "rowB"; // математика
const TOKEN_B = "TOKEN-STUDENT-B";
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

function extractBuiltinCourses(keys) {
  // локальные файлы курсов грузим в vm (сеть не нужна)
  const indexBox = { window: {}, console };
  vm.createContext(indexBox);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, "courses", "school.js"), "utf8"), indexBox, { timeout: 60000 });
  const IDX = indexBox.window.BUILTIN_INDEX || {};
  const box = { window: {}, console };
  vm.createContext(box);
  const subs = [...new Set(keys.map(k => (IDX[k] && IDX[k].subj) || null).filter(Boolean))];
  for (const subj of subs) {
    const f = path.join(REPO_ROOT, "courses", "school", subj + ".js");
    if (fs.existsSync(f)) vm.runInContext(fs.readFileSync(f, "utf8"), box, { timeout: 180000 });
  }
  const all = box.window.BUILTIN_COURSES || {};
  const out = {};
  keys.forEach(k => { if (all[k]) out[k] = all[k]; });
  return out;
}
function trimCourse(c, maxLessons = 5) {
  const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
  const lessons = (c.lessons || []).slice(0, maxLessons).map(l => ({
    id: l.id, title: l.title, date: l.date, block: l.block, oge: l.oge, learn: (l.learn || []).slice(0, 3),
    theory: (l.theory || []).slice(0, 2).map(t => ({ h: clip(t.h, 300), t: clip(t.t, 1200), mini: (t.mini || []).slice(0, 2) })),
    practice: (l.practice || []).slice(0, 2),
    test: (l.test || []).slice(0, 2),
    hwtest: (l.hwtest || []).slice(0, 2),
    hw: clip(l.hw, 500),
    writing: l.writing ? { type: l.writing.type, text: l.writing.text, task: clip(l.writing.task, 400), classwork: clip(l.writing.classwork, 400) } : null,
    materials: [],
  }));
  return {
    course: c.course, tag: c.tag, goal: c.goal, grade: c.grade, grades: c.grades || null,
    blocks: c.blocks || {}, events: [], lessons,
    texts: c.texts || {}, izl: c.izl || {}, criteria: c.criteria || { errors: [], essay: [], izl: [] },
    methodology: [],
  };
}
export function buildWorld() {
  const raw = extractBuiltinCourses(["rus-5", "math-5"]);
  const rus = trimCourse(raw["rus-5"], 5);
  const math = trimCourse(raw["math-5"], 5);
  const rowCommon = {
    teacher_id: TEACHER_ID, teacher: TEACHER_ID, person_id: PERSON_ID, grade: 5,
    registered_at: new Date().toISOString(), start_date: iso(TODAY), dates: {}, unlocked: [],
    pair_id: null, theme: null, call_url: "", goals: ["Контрольные и домашние"], goal: "Контрольные и домашние",
    contact: "", note: "", invite_token: "", covered: {}, covered_manual: {},
  };
  const students = [
    Object.assign({}, rowCommon, { id: ROW_A, name: "Аня Тестова", course: "rus-5", subject: "ru", code: "STURU01", invite_token: "invA" }),
    Object.assign({}, rowCommon, { id: ROW_B, name: "Аня Тестова", course: "math-5", subject: "math", code: "STUMAT02", invite_token: "invB" }),
  ];
  const teachers = [{
    id: TEACHER_ID, name: "Любовь Игоревна", email: "teacher@test.local", join_code: "JOIN01",
    base: true, base_access: ["oge-rus", "rus-5", "math-5"], role: "teacher", theme: null, call_url: "",
  }];
  const db = {
    seq: 5000,
    tokens: { [TOKEN_B]: ROW_B, "TOKEN-STUDENT-A": ROW_A },
    tables: {
      students, teachers, materials: [],
      course_data: [{ key: "rus-5", data: rus }, { key: "math-5", data: math }],
      board_items: [], app_settings: [], results: [], homework: [], writings: [], sheets: [], activity: [], ai_reports: [], works: [],
      topic_quizzes: [], topic_quiz_results: [],
    },
  };
  const profileOf = row => {
    const subs = students.filter(r => (r.person_id || r.id) === (row.person_id || row.id))
      .map(r => ({ id: r.id, subject: r.subject, course: r.course, grade: r.grade, name: r.name }));
    return {
      id: row.id, name: row.name, login: row.code, teacher: TEACHER_ID, grade: row.grade,
      subject: row.subject, course: row.course, person_id: row.person_id || row.id, subjects: subs,
      board_owner: row.id, call_url: "", theme: null, mascot: null, pair: null,
      unlocked: [], dates: {}, start_date: row.start_date, goals: row.goals || [], goal: row.goal || "",
    };
  };
  const lessons = {
    rus: rus.lessons.map(l => ({ id: l.id, title: l.title, testN: (l.test || []).length })),
    math: math.lessons.map(l => ({ id: l.id, title: l.title })),
  };
  return {
    db, lessons, profileOf,
    studentSession: (rowId) => {
      const row = students.find(r => r.id === rowId);
      return { token: rowId === ROW_B ? TOKEN_B : "TOKEN-STUDENT-A", profile: profileOf(row) };
    },
  };
}

const TEACHER_SESSION = { access_token: "mock-access-token", token_type: "bearer", expires_in: 3600, user: { id: TEACHER_ID, email: "teacher@test.local", user_metadata: { name: "Любовь Игоревна" } } };

/* ================= внедряемые скрипты ================= */
/* db пишем ТОЛЬКО в пустой localStorage: все вкладки одного origin делят mock-БД,
   иначе перезагрузка кабинета в Q4 или новая вкладка Q3 затёрла бы сохранённый тест. */
function seedScript({ db, session, studentSession, joinHow }) {
  return `(() => {
  if (typeof location !== "undefined" && location.protocol === "about:") return;  // about:blank — localStorage недоступен
  window.__MOCK_CFG = ${JSON.stringify({ session: session || null, reset: false })};
  try {
    if (!localStorage.getItem("mock-db-v1") && ${db ? "true" : "false"}) {
      localStorage.setItem("mock-db-v1", ${JSON.stringify(db ? JSON.stringify(db) : "null")});
      localStorage.setItem("mock-db-ver", "seed-" + Date.now());
    }
  } catch (e) { console.error("seed db", e); }
  try {
    ${studentSession
      ? `localStorage.setItem("oge-session", ${JSON.stringify(JSON.stringify(studentSession))});`
      : `localStorage.removeItem("oge-session");`}
    ${joinHow === null || joinHow === false
      ? `localStorage.removeItem("oge-join-how");`
      : `localStorage.setItem("oge-join-how", ${JSON.stringify(JSON.stringify(joinHow || "board"))});`}
  } catch (e) { console.error("seed session", e); }
})();`;
}
const blockUrls = async page => {
  // CDN в обычной сессии может быть доступен — блокируем, иначе настоящий supabase-js перезапишет мок
  try {
    await page.cdp.send("Network.enable");
    await page.cdp.send("Network.setBlockedURLs", { urls: ["*cdn.jsdelivr.net*", "*fonts.googleapis.com*", "*fonts.gstatic.com*"] });
  } catch (_) {}
};

/* ================= раннер ================= */
const TESTS = [];
const test = (id, name, fn) => TESTS.push({ id, name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(actual, expected, what) {
  if (String(actual) !== String(expected)) throw new Error(`${what}: ожидали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`);
}
const studentSession = page => page.eval(`JSON.parse(localStorage.getItem("oge-session") || "null")`);
/** последняя команда учителя нужного типа (в логе бывают и refresh/act) */
const cmdOfType = (page, type) => page.eval(`(() => { const l = window.__MOCK.cmdList().filter(c => c.type === ${JSON.stringify(type)}); return l.length ? l[l.length - 1] : null; })()`);
/** состояние приложения ученика (window.__app = {S, render} в student.js) */
const studentState = page => page.eval(`(() => { const S = window.__app && window.__app.S; return S ? {view:S.view, subject:S.profile && S.profile.subject, id:S.profile && S.profile.id, room:S.room || null, quizToken:S.quizToken || null} : null; })()`);
const teacherDB = (page, table) => page.eval(`window.__MOCK.dbTable(${JSON.stringify(table)})`);
/** найти строку плана урока в карточке ученика (кнопка «Отметить»/чип «✓») по id урока */
const coveredRow = (page, lid) => page.eval(`(() => {
  const b = document.querySelector('[data-act="covered-toggle"][data-lid="${lid}"]');
  if (!b) return null;
  const tr = b.closest("tr"); if (!tr) return null;
  const cells = [...tr.children].map(td => (td.textContent || "").trim());
  return { lid: ${JSON.stringify(lid)}, covered: cells[4] || "", done: cells[6] || "", on: b.dataset.on, hasChip: /✓/.test(cells[4] || "") };
})()`);

/* ---------- самообучение: SELF_DATA, тренажёры Play (оверлей .play-ov) ---------- */
const ST_VOWELS = "аеёиоуыэюя";
/** индекс ударной буквы ровно как Play.stParse: заглавная гласная, иначе «ё», иначе 0 */
function stressIdx(raw){
  const chars = [...String(raw || "")];
  let idx = -1;
  chars.forEach((ch, i) => { const lc = ch.toLowerCase(); if (ST_VOWELS.includes(lc) && ch !== lc) idx = i; });
  if (idx < 0){ idx = chars.findIndex(c => c.toLowerCase() === "ё"); if (idx < 0) idx = 0; }
  return idx;
}
const stressPlain = raw => [...String(raw || "").toLowerCase()].join("");
const selfWords = (page, b) => page.eval(`(window.SELF_DATA && window.SELF_DATA.stress.blocks[${b}] && window.SELF_DATA.stress.blocks[${b}].words) || []`);
const selfDeckData = (page, d) => page.eval(`(window.SELF_DATA && window.SELF_DATA.decks[${d}]) || null`);
const stressDone = page => page.eval(`!!document.querySelector('.play-ov .play-end')`);

async function selfOpen(page){
  await page.eval(`(() => { const b = document.querySelector('[data-go="self"]'); if (b) b.click(); return !!b; })()`);
  await page.waitFor(`document.querySelectorAll('[data-act="self-stress-block"]').length >= 10 ? 1 : 0`,
    { timeout: 15000, label: "экран самообучения (>=10 блоков ударений)" });
}
async function openStressBlock(page, b){
  await page.eval(`(() => { const x = document.querySelector('[data-act="self-stress-block"][data-b="${b}"]'); if (x) x.click(); return !!x; })()`);
  await page.waitFor(`document.querySelector('.play-ov .play-body .st-word .st-v') ? 1 : 0`,
    { timeout: 15000, label: "тренажёр ударений: блок " + b });
}
async function waitStressReady(page, timeout = 8000){
  await page.waitFor(`(() => { const ov = document.querySelector('.play-ov'); if (!ov) return 1; if (ov.querySelector('.play-res')) return 0; return (ov.querySelector('.play-end') || ov.querySelector('.st-word')) ? 1 : 0; })()`,
    { timeout, label: "следующее слово/финал ударений" });
}
async function closePlay(page){
  await page.eval(`(() => { const ov = document.querySelector('.play-ov'); if (!ov) return false; const x = ov.querySelector('.play-end [data-close]') || ov.querySelector('.play-x'); if (x) x.click(); return true; })()`);
  await page.waitFor(`!document.querySelector('.play-ov') ? 1 : 0`, { timeout: 6000, label: "оверлей Play закрыт" });
}
/** пройти блок ударений кликами по гласным; firstWrong — первый ответ заведомо неверный */
async function runStressMastery(page, b, { firstWrong = false, maxSteps = 320 } = {}){
  const words = await selfWords(page, b);
  assert(Array.isArray(words) && words.length >= 10, "в блоке " + b + " меньше 10 слов: " + JSON.stringify(words));
  const meta = new Map(words.map(w => [stressPlain(w), { raw: w, idx: stressIdx(w), plain: stressPlain(w) }]));
  const seen = new Map(); let steps = 0, firstBad = null, wrongDone = false, retryFeedback = false, stateAfterWrong = null;
  while (steps++ < maxSteps) {
    if (await stressDone(page)) break;
    const cur = await page.eval(`(() => { const w = document.querySelector('.play-ov .play-body .st-word'); return w ? w.textContent : null; })()`);
    assert(cur, "нет текущего слова в тренажёре ударений");
    const m = meta.get(cur);
    assert(m, "слово «" + cur + "» не найдено в SELF_DATA блока " + b);
    seen.set(cur, (seen.get(cur) || 0) + 1);
    if (!wrongDone && firstWrong) {
      const k = await page.eval(`[...document.querySelectorAll('.play-ov .st-v')].map(x => +x.dataset.k).find(k => k !== ${m.idx})`);
      assert(k != null, "не нашли неверную гласную для слова «" + cur + "»");
      await page.eval(`document.querySelector('.play-ov .st-v[data-k="${k}"]').click(); true`);
      const bad = await page.waitFor(`(() => { const f = document.querySelector('.play-ov .play-res.bad'); return f ? f.textContent : null; })()`,
        { timeout: 6000, label: "неверный ответ: подсказка .play-res.bad" });
      assert(bad.includes(m.raw), "в подсказке нет правильного ударения «" + m.raw + "»: " + JSON.stringify(bad));
      firstBad = m.plain; wrongDone = true;
      /* state-хук Play.stressState(): слово не освоено, ошибка записана, повторов +2 (reps = 3) */
      stateAfterWrong = await page.eval(`(() => { const s = window.Play && Play.stressState && Play.stressState(); return s ? {mastered: s.mastered, errors: s.errors, reps: s.reps, left: s.left, attempts: s.attempts} : null; })()`);
    } else {
      await page.eval(`document.querySelector('.play-ov .st-v[data-k="${m.idx}"]').click(); true`);
      const okText = await page.waitFor(`(() => { const f = document.querySelector('.play-ov .play-res.ok'); return f ? f.textContent : null; })()`,
        { timeout: 6000, label: "верный ответ: .play-res.ok" });
      if (firstBad === m.plain && /ещё раз|закрепим/i.test(okText)) retryFeedback = true;
    }
    await waitStressReady(page);
  }
  assert(await stressDone(page), "тренажёр ударений не дошёл до финала за " + maxSteps + " шагов");
  return { seen, firstBad, retryFeedback, stateAfterWrong };
}
/** пройти колоду карточек (или тренажёр «Мои ошибки»): Показать ответ → Знаю / Ещё учить */
async function runDeckLoop(page, { firstAgain = false, maxSteps = 400 } = {}){
  const seen = new Map(); let steps = 0, learnFront = null, backShown = 0;
  while (steps++ < maxSteps) {
    if (await page.eval(`!!document.querySelector('.play-ov .play-end')`)) break;
    const front = await page.eval(`(() => { const f = document.querySelector('.play-ov .play-body .self-front'); return f ? f.textContent : null; })()`);
    assert(front, "нет .self-front в тренажёре карточек");
    seen.set(front, (seen.get(front) || 0) + 1);
    if (await page.eval(`!!document.querySelector('.play-ov [data-show]')`)) {
      await page.eval(`document.querySelector('.play-ov [data-show]').click(); true`);
      const back = await page.waitFor(`(() => { const b = document.querySelector('.play-ov .self-back'); return b ? b.textContent : null; })()`,
        { timeout: 6000, label: "карточка: показан ответ ([data-show])" });
      assert(back && back.trim().length > 2, "пустой ответ на карточке «" + front + "»");
      backShown++;
    }
    if (!learnFront && firstAgain) { learnFront = front; await page.eval(`document.querySelector('.play-ov [data-again]').click(); true`); }
    else await page.eval(`document.querySelector('.play-ov [data-know]').click(); true`);
    await page.waitFor(`(() => { const ov = document.querySelector('.play-ov'); if (!ov) return 1; return (ov.querySelector('.play-end') || ov.querySelector('[data-show]')) ? 1 : 0; })()`,
      { timeout: 6000, label: "следующая карточка" });
  }
  assert(await page.eval(`!!document.querySelector('.play-ov .play-end')`), "колода не дошла до финала за " + maxSteps + " шагов");
  return { seen, learnFront, backShown };
}
/** дождаться строки в mock-БД (прогресс сохраняется с дебаунсом ~700 мс) */
async function waitMockRow(teacher, table, pred, timeout = 15000){
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const rows = await teacherDB(teacher, table);
    const row = rows.find(pred);
    if (row) return row;
    await sleep(150);
  }
  return null;
}
/** вкладка ученика rowA для S-сценариев (в полном прогоне её создаёт Q3) */
async function ensureSelfStudent({ browser, baseUrl }){
  if (W.quizTab) return W.quizTab;
  const page = await browser.newPage("about:blank");
  W.quizTab = page;
  await page.inject(seedScript({ db: null, session: null, studentSession: W.studentSession(ROW_A), joinHow: null }), "seed-self.js");
  await page.inject(MOCK_SRC, "mock-supabase.js");
  await blockUrls(page);
  await page.goto(baseUrl + "/index.html");
  await page.waitFor(`window.__app && window.__app.S && window.__app.S.profile ? 1 : 0`, { timeout: 25000, label: "вкладка ученика rowA (самообучение)" });
  return page;
}
/** дождаться прогресса на КАРТОЧКЕ блока (.self-blocks; в .self-prep такая же кнопка — не путать) */
async function waitBlockProgress(page, b, want = "15/15", timeout = 8000){
  const t0 = Date.now(); let last = "";
  while (Date.now() - t0 < timeout) {
    last = await page.eval(`(() => { const el = document.querySelector('.self-blocks [data-act="self-stress-block"][data-b="${b}"]'); return el ? (el.getAttribute('data-self-progress') || el.textContent || "") : ""; })()`);
    if (String(last).includes(want)) return last;
    await sleep(150);
  }
  throw new Error("карточка блока " + b + " не показывает «" + want + "» (сейчас: " + JSON.stringify(last) + ")");
}

let W = null; // world (db+lessons) — заполняется в runE2E

/* ---------- a: авто-переключение предмета + присутствие ---------- */
test("a", "Ученик на предмете B: учитель начинает урок A → сам переключается, видит материал, у учителя «онлайн»", async ({ teacher, student }) => {
  const L = W.lessons.rus[0];
  // присутствие ДО начала: ученик сейчас на строке B, но его person_id общий → строка A тоже «онлайн»
  const badgeA = await teacher.eval(`(document.querySelector('[data-online="${ROW_A}"]') || {}).textContent || ""`);
  assert(/онлайн/.test(badgeA), "у учителя строка A не «онлайн», хотя ученик в сети на предмете B: " + JSON.stringify(badgeA));
  const count0 = await teacher.eval(`(document.getElementById("online-count") || {}).textContent || ""`);
  assert(/онлайн/.test(count0), "в кабинете нет «сейчас онлайн»: " + JSON.stringify(count0));

  await teacher.eval(`document.querySelector('[data-student="${ROW_A}"]').click(); true`);
  await teacher.waitFor(`document.querySelector('[data-act="start-lesson"][data-rl="${L.id}"]') ? 1 : 0`, { timeout: 12000, label: "план урока A у учителя («▶ Урок»)" });
  const s0 = await studentSession(student);
  assert(s0 && s0.profile && s0.profile.subject === "math", "ученик должен начинать на предмете B (math), а он на " + (s0 && s0.profile && s0.profile.subject));
  await student.eval(`window.__e2eMarker = "a"; true`);
  await teacher.eval(`window.Call = null; window.__MOCK.LOG.broadcasts.length = 0; true`);
  const t0 = Date.now();
  await teacher.eval(`document.querySelector('[data-act="start-lesson"][data-rl="${L.id}"]').click(); true`);
  await sleep(150);
  const toast = await teacher.eval(`(document.getElementById("toast") || {}).textContent || ""`);
  const cmd = await cmdOfType(teacher, "lesson");
  assert(cmd, "учитель не отправил live-команду ученику (broadcast cmd)");
  eq(cmd.type, "lesson", "тип команды");
  eq(cmd.to, ROW_A, "адресат (to)");
  eq(cmd.lesson, L.id, "поле lesson в команде");
  eq(cmd.title, L.title, "поле title в команде");
  // v57: предмет ученик определяет по адресату (student_switch) — поля subj/course в команде не обязательны

  await student.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.profile && S.profile.subject === "ru" && String(S.profile.id) === "${ROW_A}" ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик сам переключился на предмет A (student_switch)" });
  await student.waitFor(`(() => { const el = document.querySelector(".roombar"); return el && el.textContent.includes(${JSON.stringify(L.title)}) ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик открыл урок A в комнате (без перезагрузки)" });
  await student.waitFor(`(() => { const b = document.querySelector("#board"); return b && b.querySelector(".bd-cv") && b.querySelector(".bd-bg") ? 1 : 0; })()`,
    { timeout: 9000, label: "у ученика смонтирована доска урока (#board .bd-cv/.bd-bg)" });
  await student.waitFor(`(() => { const bg = document.querySelector("#board .bd-bg"); return bg && (bg.textContent || "").trim().length > 30 ? 1 : 0; })()`,
    { timeout: 9000, label: "у ученика виден материал урока на доске (live-лист)" });
  const dt = Date.now() - t0;
  W.aMs = dt;
  assert(dt < 10000, `авто-переключение заняло ${dt} мс (> 10 c, порог с запасом на нагрузку CI)`);
  eq(await student.eval(`window.__e2eMarker || null`), "a", "страница ученика перезагрузилась (маркер сброшен)");

  const badge = await teacher.eval(`(document.querySelector('[data-online="${ROW_A}"]') || {}).textContent || ""`);
  assert(/онлайн/.test(badge), "у учителя нет бейджа «онлайн» у ученика: " + JSON.stringify(badge));
  assert(!/не в сети/i.test(toast), "ложный тост «ученик не в сети»: " + JSON.stringify(toast));

  // каналы доски у сторон совпадают (общая доска урока)
  await teacher.waitFor(`document.querySelector("#board .bd-cv") ? 1 : 0`, { timeout: 9000, label: "доска у учителя в комнате" });
  const tc = await teacher.eval(`window.__MOCK.channels()`);
  const sc = await student.eval(`window.__MOCK.channels()`);
  const shared = (tc || []).filter(n => n.startsWith("board-") && (sc || []).includes(n));
  assert(shared.length > 0, "каналы доски не совпадают: teacher=" + JSON.stringify(tc) + "; student=" + JSON.stringify(sc));
});

/* ---------- b1: смена урока в комнате ---------- */
test("b1", "Смена урока в комнате → у ученика новый материал < 2 c, без перезагрузки", async ({ teacher, student }) => {
  const L2 = W.lessons.rus[1];
  await teacher.waitFor(`document.getElementById("room-lesson") ? 1 : 0`, { timeout: 8000, label: "комната учителя: выбор урока" });
  await student.eval(`window.__e2eMarker = "b1"; true`);
  await teacher.eval(`window.__MOCK.LOG.broadcasts.length = 0; true`);
  const t0 = Date.now();
  await teacher.eval(`(() => { const s = document.getElementById("room-lesson"); s.value = ${JSON.stringify(L2.id)}; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await student.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.room && String(S.room.lesson) === ${JSON.stringify(L2.id)} ? 1 : 0; })()`,
    { timeout: 5000, label: "ученик получил новый урок (S.room.lesson)" });
  await student.waitFor(`(() => { const el = document.querySelector(".roombar"); return el && el.textContent.includes(${JSON.stringify(L2.title)}) ? 1 : 0; })()`,
    { timeout: 5000, label: "у ученика заголовок нового урока в комнате" });
  const dt = Date.now() - t0;
  assert(dt < 6000, `смена урока заняла ${dt} мс (> 6 c, порог с запасом на нагрузку CI)`);
  eq(await student.eval(`window.__e2eMarker || null`), "b1", "страница ученика перезагрузилась при смене урока");
  await student.waitFor(`(() => { const bg = document.querySelector("#board .bd-bg"); return bg && (bg.textContent || "").trim().length > 30 ? 1 : 0; })()`,
    { timeout: 6000, label: "у ученика материал нового урока на доске" });
  const cmd = await cmdOfType(teacher, "lesson");
  eq(cmd.lesson, L2.id, "lesson в команде смены урока");
});

/* ---------- b2: урок из другого предмета ---------- */
test("b2", "Урок из другого предмета: ученик в комнате на A, учитель открывает урок B → переключение и материал < 4 c", async ({ teacher, student }) => {
  const M = W.lessons.math[0];
  await teacher.eval(`document.querySelector('.navitem[data-view="students"]').click(); true`);
  await teacher.waitFor(`document.querySelector('[data-student="${ROW_B}"]') ? 1 : 0`, { timeout: 8000, label: "список учеников у учителя" });
  await teacher.eval(`document.querySelector('[data-student="${ROW_B}"]').click(); true`);
  await teacher.waitFor(`document.querySelector('[data-act="start-lesson"][data-rl="${M.id}"]') ? 1 : 0`, { timeout: 10000, label: "план урока B у учителя" });
  await student.eval(`window.__e2eMarker = "b2"; true`);
  await teacher.eval(`window.Call = null; window.__MOCK.LOG.broadcasts.length = 0; true`);
  const t0 = Date.now();
  await teacher.eval(`document.querySelector('[data-act="start-lesson"][data-rl="${M.id}"]').click(); true`);
  await sleep(150);
  const cmd = await cmdOfType(teacher, "lesson");
  assert(cmd, "нет команды урока B");
  eq(cmd.to, ROW_B, "адресат команды B");
  eq(cmd.lesson, M.id, "lesson команды B");
  eq(cmd.title, M.title, "title команды B");
  await student.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.profile && S.profile.subject === "math" && String(S.profile.id) === "${ROW_B}" ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик переключился на предмет B" });
  await student.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.room && String(S.room.lesson) === ${JSON.stringify(M.id)} ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик открыл урок B в комнате" });
  await student.waitFor(`(() => { const el = document.querySelector(".roombar"); return el && el.textContent.includes(${JSON.stringify(M.title)}) ? 1 : 0; })()`,
    { timeout: 8000, label: "у ученика заголовок урока B в комнате" });
  const dt = Date.now() - t0;
  W.b2Ms = dt;
  assert(dt < 10000, `переключение на другой предмет заняло ${dt} мс (> 10 c, порог с запасом на нагрузку CI)`);
  eq(await student.eval(`window.__e2eMarker || null`), "b2", "страница ученика перезагрузилась при смене предмета");
  await student.waitFor(`(() => { const bg = document.querySelector("#board .bd-bg"); return bg && (bg.textContent || "").trim().length > 30 ? 1 : 0; })()`,
    { timeout: 8000, label: "у ученика материал урока B на доске" });
  const badge = await teacher.eval(`(document.querySelector('[data-online="${ROW_B}"]') || {}).textContent || ""`);
  assert(/онлайн/.test(badge), "у учителя нет «онлайн» у строки B: " + JSON.stringify(badge));
});

/* ---------- b3: refresh в комнате ---------- */
test("b3", "refresh в комнате: тост «Материалы обновились», доска не сбрасывается, без перезагрузки", async ({ teacher, student }) => {
  await student.eval(`window.__e2eMarker = "b3"; true`);
  await teacher.eval(`(async () => {
    const ch = window.__MOCK.client.channel("live-${TEACHER_ID}", {config: {broadcast: {self: false}}});
    await new Promise(res => ch.subscribe(() => res()));
    ch.send({type: "broadcast", event: "cmd", payload: {cmd: true, to: ${JSON.stringify(ROW_B)}, type: "refresh", msg: "Материалы обновились"}});
    await new Promise(r => setTimeout(r, 250));
    ch.unsubscribe();
    return true;
  })()`);
  await student.waitFor(`(() => { const t = document.getElementById("toast"); return t && !t.hidden && t.textContent.includes("Материалы обновились") ? 1 : 0; })()`,
    { timeout: 6000, label: "ученик получил refresh (тост «Материалы обновились»)" });
  await sleep(250);
  eq(await student.eval(`window.__e2eMarker || null`), "b3", "страница ученика перезагрузилась на refresh");
  assert(await student.eval(`!!document.querySelector("#board .bd-cv")`), "доска исчезла после refresh (S.pendingRender должен сохранять доску)");
});

/* ---------- Q1: учитель собрал тест по темам ---------- */
test("Q1", "Учитель собрал тест по 2 темам → строка в topic_quizzes, ссылка ?quiz=, «Открыть у ученика» шлёт cmd quiz", async ({ teacher }) => {
  await teacher.eval(`document.querySelector('.navitem[data-view="students"]').click(); true`);
  await teacher.waitFor(`document.querySelector('[data-student="${ROW_A}"]') ? 1 : 0`, { timeout: 8000, label: "список учеников у учителя" });
  await teacher.eval(`document.querySelector('[data-student="${ROW_A}"]').click(); true`);
  await teacher.waitFor(`document.getElementById("qz-card") ? 1 : 0`, { timeout: 10000, label: "карточка «Тест по темам» у учителя" });

  const topics = await teacher.eval(`[...document.querySelectorAll("[data-qz-topic]")].map(x => x.value)`);
  assert(topics.length >= 2, "в карточке меньше 2 тем-уроков: " + JSON.stringify(topics));
  W.lessonA = topics[0];
  // выбираем 2 темы и 2 вопроса на тему (детерминированно, быстро); после каждой отметки render() пересоздаёт DOM
  await teacher.eval(`(() => { const b = [...document.querySelectorAll("[data-qz-topic]")][0]; b.checked = true; b.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await sleep(120);
  await teacher.eval(`(() => { const b = [...document.querySelectorAll("[data-qz-topic]")][1]; b.checked = true; b.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await sleep(120);
  await teacher.eval(`(() => { const cnt = document.getElementById("qz-count"); if (cnt){ cnt.value = "2"; cnt.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
  await sleep(100);
  await teacher.eval(`document.querySelector('[data-act="qz-build"]').click(); true`);
  await teacher.waitFor(`document.getElementById("qz-title") && document.querySelector('[data-act="qz-save"]') ? 1 : 0`,
    { timeout: 20000, label: "предпросмотр теста (название + «Сохранить и получить ссылку»)" });
  const draftInfo = await teacher.eval(`(() => {
    const t = document.getElementById("qz-title"), card = document.getElementById("qz-card");
    return { title: t ? t.value : null, topics: card ? card.querySelectorAll(".qz-topic").length : 0,
             save: !!(card && card.querySelector('[data-act="qz-save"]')),
             text: card ? (card.textContent || "") : "" };
  })()`);
  assert(draftInfo.title && draftInfo.title.length > 3, "в предпросмотре нет названия теста (#qz-title): " + JSON.stringify(draftInfo.title));
  assert(draftInfo.topics >= 2, "в предпросмотре меньше 2 групп тем (.qz-topic): " + draftInfo.topics);
  assert(draftInfo.save, "в предпросмотре нет кнопки [data-act=qz-save]");
  assert(/вопросов\s*:\s*\d+/i.test(draftInfo.text) || /Предпросмотр:\s*\d+\s*вопр/i.test(draftInfo.text), "предпросмотр не показывает число вопросов: " + JSON.stringify(draftInfo.text.slice(-300)));

  await teacher.eval(`document.querySelector('[data-act="qz-save"]').click(); true`);
  await teacher.waitFor(`document.querySelector("[data-qz-link]") && document.getElementById("qz-link") ? 1 : 0`,
    { timeout: 15000, label: "ссылка ?quiz= после сохранения теста" });
  const link = await teacher.eval(`document.getElementById("qz-link").value`);
  const m = /[?&]quiz=([^&]+)/.exec(link || "");
  assert(m, "в ссылке нет ?quiz=КОД: " + JSON.stringify(link));
  W.quizId = decodeURIComponent(m[1]);
  const anchorOk = await teacher.eval(`(() => { const a = document.querySelector("[data-qz-link]"); return a ? /[?&]quiz=/.test(a.getAttribute("href") || "") : false; })()`);
  assert(anchorOk, "нет ссылки [data-qz-link] с ?quiz=");

  const quizzes = await teacherDB(teacher, "topic_quizzes");
  const row = quizzes.find(q => q.id === W.quizId);
  assert(row, "в mock-БД нет строки topic_quizzes с id " + W.quizId + ": " + JSON.stringify(quizzes.map(q => q.id)));
  eq(row.student_id, ROW_A, "quizzes.student_id");
  assert(Array.isArray(row.data.questions) && row.data.questions.length >= 2, "в тесте меньше 2 вопросов: " + JSON.stringify(row.data && row.data.questions && row.data.questions.length));
  assert(Array.isArray(row.data.topics) && row.data.topics.length >= 2, "в тесте меньше 2 тем: " + JSON.stringify(row.data && row.data.topics));
  assert(row.data.questions.every(q => q.topic && q.topicId), "у вопроса нет topic/topicId: " + JSON.stringify(row.data.questions.find(q => !q.topic || !q.topicId)));
  W.quizTopic = row.data.questions.find(q => q.topic)?.topic || "";
  W.quizQuestions = row.data.questions;

  // «Открыть у ученика» → live cmd type "quiz"
  await teacher.eval(`window.__MOCK.LOG.broadcasts.length = 0; true`);
  await teacher.eval(`document.querySelector('[data-act="qz-open"]').click(); true`);
  const quizCmd = await teacher.waitFor(`(() => { const l = window.__MOCK.cmdList().filter(c => c.type === "quiz"); return l.length ? l[l.length - 1] : null; })()`,
    { timeout: 6000, label: "live cmd type=quiz после «Открыть у ученика»" });
  eq(quizCmd.token, W.quizId, "cmd quiz.token");
  eq(quizCmd.to, ROW_A, "cmd quiz.to");
  assert(quizCmd.title, "в cmd quiz нет title");
});

/* ---------- Q2: ручное «пройдено» ---------- */
test("Q2", "Ручное «пройдено»: covered+covered_manual, чип ✓, «Выполнено» не меняется, повторное нажатие снимает", async ({ teacher }) => {
  await teacher.waitFor(`document.querySelector("[data-act='covered-toggle']") ? 1 : 0`, { timeout: 10000, label: "кнопки «Отметить» в таблице уроков" });
  const before = await coveredRow(teacher, W.lessonA);
  assert(before, "не нашли строку урока с [data-act=covered-toggle][data-lid=" + W.lessonA + "]");
  eq(before.on, "1", "до отметки data-on (ожидали кнопку «Отметить» с data-on=1)");
  await teacher.eval(`document.querySelector('[data-act="covered-toggle"][data-lid="${W.lessonA}"][data-on="1"]').click(); true`);
  const after = await teacher.waitFor(`(() => {
    const row = window.__MOCK.dbTable("students").find(x => x.id === "${ROW_A}");
    return row && row.covered_manual && row.covered_manual[${JSON.stringify(W.lessonA)}] ? row : null;
  })()`, { timeout: 8000, label: "mock-БД: students.covered_manual обновился" });
  assert(after.covered && after.covered[W.lessonA], "в students.covered нет отметки: " + JSON.stringify(after.covered));
  const rowAfter = await coveredRow(teacher, W.lessonA);
  assert(rowAfter && rowAfter.hasChip, "в карточке не появился чип «✓»: " + JSON.stringify(rowAfter));
  eq(rowAfter.done, before.done, "колонка «Выполнено» изменилась после ручной отметки");
  // снятие
  await teacher.eval(`document.querySelector('[data-act="covered-toggle"][data-lid="${W.lessonA}"][data-on="0"]').click(); true`);
  await teacher.waitFor(`(() => { const row = window.__MOCK.dbTable("students").find(x => x.id === "${ROW_A}"); return row && (!row.covered_manual || !row.covered_manual[${JSON.stringify(W.lessonA)}]) ? 1 : 0; })()`,
    { timeout: 8000, label: "повторное нажатие сняло covered_manual" });
  const rowOff = await coveredRow(teacher, W.lessonA);
  assert(rowOff && !rowOff.hasChip && rowOff.on === "1", "после снятия снова должна быть кнопка «Отметить»: " + JSON.stringify(rowOff));
});

/* ---------- Q3: ученик проходит тест по прямой ссылке ---------- */
test("Q3", "Ученик открывает ?quiz=: неверно → объяснение + повтор, повторно неверно → «Дальше» и тема needs_work; финиш + rpc quiz_submit", async ({ teacher, student, browser, baseUrl }) => {
  assert(W.quizId, "Q1 не сохранил тест — Q3 нечего открывать");
  const quiz = (await teacherDB(teacher, "topic_quizzes")).find(q => q.id === W.quizId);
  assert(quiz, "в mock-БД нет теста " + W.quizId);
  const qs = quiz.data.questions;
  assert(qs.length >= 2, "в тесте меньше 2 вопросов");
  const topicOfFirst = qs[0].topic;

  /* Вкладки делят origin/localStorage: закрываем старую вкладку ученика, чтобы её сессия (rowB)
     не перетирала сессию rowA у новой. Комнату учителя специально НЕ завершаем — проверяем, что
     ссылка на тест открывается даже во время урока (presence не должен выдёргивать ученика в комнату). */
  try { await student.close(); } catch (_) {}

  const page = await browser.newPage("about:blank");
  W.quizTab = page;
  try {
    await page.inject(seedScript({ db: null, session: null, studentSession: W.studentSession(ROW_A), joinHow: null }), "seed-quiz.js");
    await page.inject(MOCK_SRC, "mock-supabase.js");
    await blockUrls(page);
    await page.goto(baseUrl + "/index.html?quiz=" + encodeURIComponent(W.quizId));
    await page.waitFor(`window.__app && window.__app.S && document.querySelector(".quiz-wrap .quiz-opt") ? 1 : 0`,
      { timeout: 25000, label: "тест открылся по прямой ссылке (index.html?quiz=)" });
    const st0 = await studentState(page);
    eq(st0.view, "quiz", "S.view после перехода по ссылке");
    eq(st0.quizToken, null, "S.quizToken должен сброситься после открытия теста");

    /* вопрос 1: неверно → объяснение + повтор → неверно повторно → «Дальше» */
    const wrong1 = (+qs[0].a + 1) % qs[0].o.length;
    await page.eval(`document.querySelector('[data-qopt="${wrong1}"]').click(); true`);
    const fbNo = await page.waitFor(`(() => { const f = document.querySelector(".quiz-fb.no"); return f ? f.textContent : null; })()`,
      { timeout: 6000, label: "неверный ответ → .quiz-fb.no" });
    assert(/Объяснение ИИ|Один плюс|Правильный ответ|\./i.test(fbNo) && fbNo.trim().length > 5, "в .quiz-fb.no нет объяснения: " + JSON.stringify(fbNo));
    assert(await page.eval(`!!document.querySelector("[data-qretry]")`), "после первой ошибки нет кнопки повтора [data-qretry]");
    await page.eval(`document.querySelector("[data-qretry]").click(); true`);
    await page.waitFor(`(() => { const o = document.querySelector("[data-qopt]"); return !document.querySelector(".quiz-fb") && o && !o.disabled ? 1 : 0; })()`,
      { timeout: 5000, label: "повтор: варианты снова доступны, объяснение скрыто" });
    /* второй неверный вариант: гарантированно не верный (при 2 вариантах формула по модулю дала бы верный) */
    const wrong2 = [0, 1, 2, 3, 4, 5].find(i => i < qs[0].o.length && i !== +qs[0].a && i !== wrong1);
    assert(wrong2 != null, "не нашли второй неверный вариант: a=" + qs[0].a + ", o=" + qs[0].o.length);
    await page.eval(`document.querySelector('[data-qopt="${wrong2}"]').click(); true`);
    await page.waitFor(`!!document.querySelector(".quiz-fb.no")`, { timeout: 6000, label: "вторая ошибка → .quiz-fb.no" });
    assert(await page.eval(`!!document.querySelector("[data-qnext]")`), "после второй ошибки нет кнопки «Дальше» [data-qnext]");
    await page.eval(`document.querySelector("[data-qnext]").click(); true`);
    await page.waitFor(`(() => { const A = window.__app.S.qz; return A && A.i === 1 ? 1 : 0; })()`, { timeout: 6000, label: "переход ко второму вопросу" });

    /* остальные вопросы — верно */
    for (let i = 1; i < qs.length; i++) {
      const a = +qs[i].a;
      await page.waitFor(`(() => { const A = window.__app.S.qz; return A && A.i === ${i} ? 1 : 0; })()`, { timeout: 6000, label: "вопрос " + (i + 1) });
      await page.eval(`document.querySelector('[data-qopt="${a}"]').click(); true`);
      await page.waitFor(`!!document.querySelector(".quiz-fb.ok")`, { timeout: 6000, label: "верный ответ на вопрос " + (i + 1) });
      await page.eval(`document.querySelector("[data-qnext]").click(); true`);
      await sleep(120);
    }
    await page.waitFor(`document.querySelector(".quiz-result[data-qresult]") ? 1 : 0`, { timeout: 10000, label: "экран итогов .quiz-result" });
    const resultText = await page.eval(`document.querySelector(".quiz-result").textContent`);
    const score = qs.length - 1;
    assert(new RegExp("(^|\\D)" + score + "(\\D|$)").test(resultText), "на итогах нет score " + score + ": " + JSON.stringify(resultText.slice(0, 300)));
    assert(resultText.includes(String(qs.length)) && /Надо доработать/i.test(resultText), "на итогах нет «Надо доработать» и total: " + JSON.stringify(resultText.slice(0, 300)));
    const badChip = await page.eval(`(() => { const b = document.querySelector(".quiz-result .chip.bad"); return b ? b.textContent : null; })()`);
    assert(badChip && badChip.includes(topicOfFirst), "чип темы на доработку не совпал: " + JSON.stringify(badChip) + ", тема " + JSON.stringify(topicOfFirst));
    assert(await page.eval(`!!document.querySelector(".quiz-result #qz-map .qz-topic.bad")`), "на итогах нет карты тем с .qz-topic.bad");

    /* mock-БД: quiz_submit записал результат (запись асинхронная — ждём появления строки) */
    let rows = [];
    let res = null;
    for (let i = 0; i < 40 && !res; i++) {
      rows = await teacherDB(teacher, "topic_quiz_results");
      res = rows.filter(r => r.quiz_id === W.quizId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
      if (!res) await sleep(100);
    }
    if (!res) {
      const diag = {
        rpcs: await page.eval(`JSON.stringify(window.__MOCK.rpcNames ? window.__MOCK.rpcNames() : null)`),
        lastSubmit: await page.eval(`JSON.stringify(window.__MOCK.lastRpc("quiz_submit"))`),
        quizDb: await page.eval(`JSON.stringify(window.__MOCK.dbTable("topic_quiz_results"))`),
        teacherDb: JSON.stringify(rows),
        errs: page.errors.slice(-4),
        token: await page.eval(`(window.__app && window.__app.S && window.__app.S.token) || null`),
      };
      throw new Error("quiz_submit не записал результат в mock-БД: " + JSON.stringify(diag).slice(0, 1500));
    }
    eq(res.score, score, "topic_quiz_results.score");
    eq(res.total, qs.length, "topic_quiz_results.total");
    eq(res.student_id, ROW_A, "topic_quiz_results.student_id");
    assert(Array.isArray(res.needs_work) && res.needs_work.includes(topicOfFirst), "в needs_work нет темы с ошибкой: " + JSON.stringify(res.needs_work));
    const t0 = (res.details.topics || []).find(t => (t.title || t.id) === topicOfFirst) || (res.details.topics || [])[0];
    assert(t0 && t0.needsWork === true, "в details.topics нет needsWork по теме: " + JSON.stringify(res.details.topics));
    const q0 = (res.details.questions || [])[0];
    assert(q0 && q0.attempts === 2 && q0.ok === false && q0.first === false, "details.questions[0] не отражает две попытки: " + JSON.stringify(q0));
    /* LOG мока локальный на вкладку: quiz_submit уходит из вкладки ученика (W.quizTab), не из кабинета */
    const rpc = await page.eval(`window.__MOCK.lastRpc("quiz_submit")`);
    assert(rpc && rpc.keys && rpc.keys.join(",") === "p_code,p_token,p_score,p_total,p_details,p_needs_work",
      "quiz_submit вызван с неверными именами параметров: " + JSON.stringify(rpc && rpc.keys));
  } catch (e) {
    // диагностика для владельцев student.js: что было на экране
    try { console.log("       [Q3 debug] view=" + JSON.stringify(await studentState(page))); } catch (_) {}
    throw e;
  }
});

/* ---------- Q4: карта тем у учителя и ученика ---------- */
test("Q4", "Карта тем: у учителя #qz-map .qz-topic.bad с темой, у ученика раздел «Тесты» с картой", async ({ teacher }) => {
  const topic = W.quizTopic || (W.quizQuestions && W.quizQuestions[0] && W.quizQuestions[0].topic) || "";
  assert(topic, "Q1 не сохранил тему теста");

  /* учитель: карточка rowA → карта тем; если live-обновление не дошло, перезагружаем кабинет (мок-БД общая) */
  const openTeacherMap = async () => {
    await teacher.eval(`document.querySelector('.navitem[data-view="students"]') && document.querySelector('.navitem[data-view="students"]').click(); true`);
    await teacher.waitFor(`document.querySelector('[data-student="${ROW_A}"]') ? 1 : 0`, { timeout: 8000, label: "список учеников" });
    await teacher.eval(`document.querySelector('[data-student="${ROW_A}"]').click(); true`);
    await teacher.waitFor(`document.querySelector("#qz-map") ? 1 : 0`, { timeout: 10000, label: "#qz-map в карточке ученика" });
  };
  await openTeacherMap();
  let tBad = await teacher.eval(`(() => { const b = document.querySelector("#qz-map .qz-topic.bad"); return b ? b.textContent : null; })()`);
  if (!tBad) {
    // карта могла ещё не обновиться из БД — обновляем данные карточки кнопкой «Обновить» (loadAll + render)
    await teacher.eval(`(() => { const b = document.querySelector('[data-act="reload"]'); if (b) b.click(); return true; })()`);
    await sleep(400);
    await teacher.eval(`document.querySelector('[data-student="${ROW_A}"]') && document.querySelector('[data-student="${ROW_A}"]').click(); true`);
    await teacher.waitFor(`document.querySelector("#qz-map") ? 1 : 0`, { timeout: 10000, label: "#qz-map после обновления карточки" });
    tBad = await teacher.eval(`(() => { const b = document.querySelector("#qz-map .qz-topic.bad"); return b ? b.textContent : null; })()`);
  }
  assert(tBad, "у учителя в #qz-map нет .qz-topic.bad (тема с ошибкой)");
  assert(tBad.includes(topic), "в .qz-topic.bad нет темы «" + topic + "»: " + JSON.stringify(tBad));
  const need = await teacher.eval(`document.querySelector("#qz-map .qz-need") ? document.querySelector("#qz-map .qz-need").textContent : ""`);
  assert(/Надо доработать/i.test(need) && need.includes(topic), "в блоке «Надо доработать» нет темы: " + JSON.stringify(need));

  /* ученик: раздел «Тесты» → карта тем по результатам */
  const page = W.quizTab;
  assert(page, "нет вкладки ученика из Q3");
  await page.eval(`(() => { const b = document.querySelector('[data-go="quizzes"]'); if (b) b.click(); return true; })()`);
  await page.waitFor(`(() => { const S = window.__app && window.__app.S; return S && S.view === "quizzes" ? 1 : 0; })()`,
    { timeout: 8000, label: "ученик открыл раздел «Тесты»" });
  await page.waitFor(`(() => { const m = document.querySelector("#qz-map"); return m && (m.textContent || "").trim().length > 10 ? 1 : 0; })()`,
    { timeout: 10000, label: "#qz-map в разделе «Тесты»" });
  await page.waitFor(`document.querySelector("#qz-map .qz-topic.bad") ? 1 : 0`, { timeout: 10000, label: "у ученика карта тем с .qz-topic.bad" });
  const sBad = await page.eval(`document.querySelector("#qz-map .qz-topic.bad").textContent`);
  assert(sBad.includes(topic), "у ученика в карте тема не совпала: " + JSON.stringify(sBad) + ", ожидали " + JSON.stringify(topic));
});

/* ---------- S1–S4: самообучение (блоки ударений, карточки, ошибки, прогресс) ---------- */
test("S1", "Самообучение: блок ударений — ошибка с подсказкой, повтор, 15/15; прогресс works и результат self сохраняются", async ({ teacher, browser, baseUrl }) => {
  const page = await ensureSelfStudent({ browser, baseUrl });
  await selfOpen(page);
  const blocks = await page.eval(`document.querySelectorAll('[data-act="self-stress-block"]').length`);
  assert(blocks >= 10, "блоков ударений меньше 10: " + blocks);
  await openStressBlock(page, 0);
  const res = await runStressMastery(page, 0, { firstWrong: true });
  assert(res.firstBad, "не удалось сделать ошибку в блоке: нет .play-res.bad");
  await page.waitFor(`!!document.querySelector('.play-ov .play-end') ? 1 : 0`, { timeout: 12000, label: "финал блока ударений (.play-end)" });
  const work = await waitMockRow(teacher, "works", w => w.lesson_id === "self:stress" && +w.task === 0 && w.data && w.data.done === true);
  assert(work, "не сохранился прогресс works self:stress task=0 done=true: " + JSON.stringify(await teacherDB(teacher, "works")).slice(0, 400));
  const mastered = work.data.mastered || [];
  eq(mastered.length, 15, "works self:stress p_data.mastered.length");
  assert(mastered.every(x => typeof x === "string"), "mastered должен быть массивом слов: " + JSON.stringify(mastered).slice(0, 200));
  const errs = work.data.errors || {};
  assert((+errs[res.firstBad] || 0) >= 1, "в p_data.errors нет ошибки «" + res.firstBad + "»: " + JSON.stringify(errs).slice(0, 200));
  eq(work.data.total, 15, "works self:stress p_data.total");
  const result = await waitMockRow(teacher, "results", r => r.kind === "self" && String(r.lesson_id).startsWith("self:stress"));
  assert(result, "нет результата kind self lesson_id self:stress: " + JSON.stringify(await teacherDB(teacher, "results")).slice(0, 400));
  eq(result.score, 15, "results.score блока ударений");
  await closePlay(page);
  await waitBlockProgress(page, 0, "15/15");
});

test("S2", "Самообучение: ошибка возвращает слово (+2), оно не освоено и попадает в errors; после верного ответа слово ещё раз", async ({ teacher, browser, baseUrl }) => {
  const page = await ensureSelfStudent({ browser, baseUrl });
  await selfOpen(page);
  await openStressBlock(page, 1);
  const res = await runStressMastery(page, 1, { firstWrong: true });
  assert(res.firstBad, "нет ошибочного ответа в блоке 1");
  assert(res.stateAfterWrong, "Play.stressState() не вернул состояние (нет state-хука)");
  const stWrong = res.stateAfterWrong || {};
  assert(!((stWrong.mastered || []).map(x => String(x)).includes(res.firstBad)), "после ошибки слово «" + res.firstBad + "» уже освоено: " + JSON.stringify(stWrong.mastered).slice(0, 200));
  assert((+((stWrong.errors || {})[res.firstBad]) || 0) >= 1, "в Play.stressState().errors нет ошибки «" + res.firstBad + "»: " + JSON.stringify(stWrong.errors).slice(0, 200));
  assert((+(stWrong.reps || {})[res.firstBad] || 0) >= 3, "после ошибки у слова не +2 повтора (reps=" + JSON.stringify((stWrong.reps || {})[res.firstBad]) + ", ожидали >=3)");
  assert((res.seen.get(res.firstBad) || 0) >= 2, "слово «" + res.firstBad + "» не появилось повторно (ожидали +2): " + JSON.stringify([...res.seen.entries()].slice(0, 5)));
  assert(res.retryFeedback, "после ошибки не было пометки «Слово встретится ещё раз – закрепим» (повтор +2)");
  await page.waitFor(`!!document.querySelector('.play-ov .play-end') ? 1 : 0`, { timeout: 12000, label: "финал блока 1 (.play-end)" });
  const work = await waitMockRow(teacher, "works", w => w.lesson_id === "self:stress" && +w.task === 1 && w.data && w.data.done === true);
  assert(work, "не сохранился прогресс works self:stress task=1 done=true");
  eq((work.data.mastered || []).length, 15, "works task=1 mastered.length");
  assert((+((work.data.errors || {})[res.firstBad]) || 0) >= 1, "в p_data.errors нет слова с ошибкой «" + res.firstBad + "»: " + JSON.stringify(work.data.errors).slice(0, 200));
  const result = await waitMockRow(teacher, "results", r => r.kind === "self" && String(r.lesson_id).startsWith("self:stress"));
  assert(result, "нет результата kind self по блоку 1");
  eq(result.total, 15, "results.total блока 1");
  await closePlay(page);
});

test("S3", "Самообучение: карточки — «Показать ответ», «Ещё учить» возвращает карточку, «Знаю» до всех карточек; прогресс и результат", async ({ teacher, browser, baseUrl }) => {
  const page = await ensureSelfStudent({ browser, baseUrl });
  await selfOpen(page);
  const hasDeck = await page.eval(`!!document.querySelector('[data-act="self-deck"][data-d="0"]')`);
  assert(hasDeck, "нет колоды «Паронимы» ([data-act=self-deck][data-d=0])");
  await page.eval(`document.querySelector('[data-act="self-deck"][data-d="0"]').click(); true`);
  await page.waitFor(`document.querySelector('.play-ov .play-body .self-front') ? 1 : 0`, { timeout: 15000, label: "тренажёр карточек открыт" });
  const deck = await selfDeckData(page, 0);
  assert(deck && Array.isArray(deck.cards) && deck.cards.length, "нет SELF_DATA.decks[0]");
  const total = deck.cards.filter(c => c && c.f).length;
  const res = await runDeckLoop(page, { firstAgain: true });
  assert(res.learnFront, "не удалось нажать «Ещё учить» на первой карточке");
  assert((res.seen.get(res.learnFront) || 0) >= 2, "карточка «Ещё учить» не вернулась в очередь: " + res.learnFront);
  assert(res.backShown >= total, "карточки показывали ответ реже, чем карточек: " + res.backShown + " из " + total);
  await page.waitFor(`!!document.querySelector('.play-ov .play-end') ? 1 : 0`, { timeout: 12000, label: "финал колоды (.play-end)" });
  const work = await waitMockRow(teacher, "works", w => w.lesson_id === "self:deck" && +w.task === 0 && w.data && w.data.done === true);
  assert(work, "не сохранился прогресс works self:deck task=0 done=true: " + JSON.stringify(await teacherDB(teacher, "works")).slice(0, 400));
  eq((work.data.mastered || []).length, total, "works self:deck p_data.mastered.length (=все карточки)");
  const result = await waitMockRow(teacher, "results", r => r.kind === "self" && String(r.lesson_id).startsWith("self:cards"));
  assert(result, "нет результата kind self lesson_id self:cards (колода): " + JSON.stringify(await teacherDB(teacher, "results")).slice(0, 400));
  await closePlay(page);
});

test("S4", "Самообучение: прогресс подхватывается после перезагрузки, «Мои ошибки» собираются и уменьшаются, есть «Что подтянуть»", async ({ teacher, browser, baseUrl }) => {
  const page = await ensureSelfStudent({ browser, baseUrl });
  // перезагрузка: прогресс и ошибки должны прийти из student_state.works
  await page.goto(baseUrl + "/index.html");
  await page.waitFor(`window.__app && window.__app.S && document.querySelector('[data-go="self"]') ? 1 : 0`,
    { timeout: 25000, label: "ученик после перезагрузки" });
  await selfOpen(page);
  const prep = await page.eval(`(() => { const p = document.querySelector('.self-prep'); return p ? p.textContent : null; })()`);
  assert(prep && /подтянуть/i.test(prep), "нет блока рекомендаций «Что подтянуть» (.self-prep): " + JSON.stringify(prep));
  assert(await page.eval(`!!document.querySelector('.self-prep [data-act="self-stress-block"]')`), "в рекомендациях нет кнопки «ударения»");
  assert(await page.eval(`!!document.querySelector('.self-prep [data-act="self-deck"]')`), "в рекомендациях нет кнопки «карточки»");
  const label0 = await page.eval(`(() => { const b = document.querySelector('.self-blocks [data-act="self-stress-block"][data-b="0"]'); return b ? (b.getAttribute('data-self-progress') || b.textContent || "") : ""; })()`);
  assert(/15\s*\/\s*15/.test(label0), "после перезагрузки карточка блока 0 не показывает 15/15 (прогресс не подхватился): " + JSON.stringify(label0));
  const left0 = +(await page.eval(`(() => { const b = document.querySelector('[data-act="self-errors"]'); if (!b) return 0; return b.getAttribute('data-self-errors-left') || 0; })()`)) || 0;
  assert(left0 >= 2, "в «Моих ошибках» меньше 2 элементов (ожидали ошибку блока и карточку): " + left0);
  // проходим «Мои ошибки» (cardDeck по items): все «Знаю»
  await page.eval(`document.querySelector('[data-act="self-errors"]').click(); true`);
  await page.waitFor(`document.querySelector('.play-ov .play-body .self-front') ? 1 : 0`, { timeout: 15000, label: "тренажёр «Мои ошибки» открыт (карточки)" });
  await runDeckLoop(page);
  const errWork = await waitMockRow(teacher, "works", w => w.lesson_id === "self:errors" && +w.task === 0 && Array.isArray(w.data && w.data.items) && w.data.items.length < left0);
  assert(errWork, "в works self:errors не уменьшился список items (было " + left0 + "): " + JSON.stringify(await teacherDB(teacher, "works")).slice(0, 500));
  await closePlay(page);
  /* после закрытия оверлея счётчик ошибок на экране уменьшился/исчез */
  const t0 = Date.now();
  let leftAfter = left0;
  while (Date.now() - t0 < 8000) {
    leftAfter = +(await page.eval(`(() => { const b = document.querySelector('[data-act="self-errors"]'); if (!b) return 0; return b.getAttribute('data-self-errors-left') || 0; })()`)) || 0;
    if (leftAfter < left0) break;
    await sleep(200);
  }
  assert(leftAfter < left0, "после прохождения «Моих ошибок» счётчик data-self-errors-left не уменьшился: было " + left0 + ", стало " + leftAfter);
});

/* ================= запуск ================= */
function ensureArtifacts() { fs.mkdirSync(ARTIFACTS, { recursive: true }); }

async function bootTabs(browser, baseUrl, world) {
  const teacher = await browser.newPage("about:blank");
  await teacher.inject(seedScript({ db: world.db, session: TEACHER_SESSION, studentSession: null }), "seed-teacher.js");
  await teacher.inject(MOCK_SRC, "mock-supabase.js");
  await blockUrls(teacher);
  await teacher.goto(baseUrl + "/teacher.html");
  await teacher.waitFor(`(() => { const b = Array.from(document.querySelectorAll("[data-student]")); return b.length >= 2 ? 1 : 0; })()`,
    { timeout: 30000, label: "кабинет учителя: карточки учеников загрузились" });

  const student = await browser.newPage("about:blank");
  await student.inject(seedScript({ db: world.db, session: null, studentSession: world.studentSession(ROW_B), joinHow: "board" }), "seed-student.js");
  await student.inject(MOCK_SRC, "mock-supabase.js");
  await blockUrls(student);
  await student.goto(baseUrl + "/index.html");
  await student.waitFor(`(() => { const s = localStorage.getItem("oge-session"); if (!s) return 0; const o = JSON.parse(s); return o && o.profile && window.__app && window.__app.S && document.querySelector(".topnav") ? 1 : 0; })()`,
    { timeout: 30000, label: "приложение ученика загрузилось (главная)" });

  await teacher.waitFor(`(() => { const el = document.querySelector('[data-online="${ROW_B}"]'); return el && /онлайн/.test(el.textContent || "") ? 1 : 0; })()`,
    { timeout: 25000, label: "учитель видит ученика онлайн (presence)" });
  return { teacher, student };
}

export async function runE2E({ headless = process.env.E2E_HEADLESS !== "0", only = process.env.E2E_ONLY || "" } = {}) {
  const server = await startServer({ port: PORT });
  const browser = await launch({
    headless, width: 1440, height: 1000, port: CDP_PORT,
    extraArgs: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const results = [];
  const extraTabs = [];
  try {
    W = buildWorld();
    W.baseUrl = server.url;
    const { teacher, student } = await bootTabs(browser, server.url, W);
    const ctx = { teacher, student, browser, baseUrl: server.url, extraTabs };
    const filter = String(only).split(/[,;]/).map(s => s.trim()).filter(Boolean);
    for (const t of TESTS) {
      if (filter.length && !filter.some(f => t.id.toLowerCase().startsWith(f.toLowerCase()))) continue;
      const eBefore = teacher.errors.length, sBefore = student.errors.length;
      const cBefore = teacher.console.length, csBefore = student.console.length;
      const t0 = Date.now();
      let pass = false, err = null;
      try { await t.fn(ctx); pass = true; }
      catch (e) {
        err = e;
        try { ensureArtifacts(); await teacher.screenshot(path.join(ARTIFACTS, `e2e-${t.id}-teacher.png`)); } catch (_) {}
        try { ensureArtifacts(); await student.screenshot(path.join(ARTIFACTS, `e2e-${t.id}-student.png`)); } catch (_) {}
        if (W.quizTab) { try { ensureArtifacts(); await W.quizTab.screenshot(path.join(ARTIFACTS, `e2e-${t.id}-quiz.png`)); } catch (_) {} }
        if (W.quizTab && !W.quizTabClosed) { extraTabs.push(W.quizTab); W.quizTabClosed = true; }
      }
      const tabs = [teacher, student, ...(W.quizTab && !W.quizTabClosed ? [W.quizTab] : [])];
      const consoleErrors = tabs.flatMap(p => p.console).filter(c => c.type === "error").map(c => c.text).slice(0, 10);
      const pageErrors = [...teacher.errors.slice(eBefore), ...student.errors.slice(sBefore), ...(W.quizTab ? W.quizTab.errors : [])].slice(0, 6);
      results.push({ id: t.id, name: t.name, pass, ms: Date.now() - t0, error: err ? String(err.message || err) : null, consoleErrors, pageErrors });
      console.log(`[${pass ? "PASS" : "FAIL"}] ${t.id} ${t.name}${pass ? "" : "\n       " + (err && err.message || err)}`);
      if (!pass) {
        if (pageErrors.length) console.log("       pageErrors: " + pageErrors.join(" | ").slice(0, 1200));
        if (consoleErrors.length) console.log("       console: " + consoleErrors.join(" | ").slice(0, 1200));
      }
    }
    const failed = results.filter(r => !r.pass).length;
    const timings = [W.aMs && `a=${W.aMs}мс`, W.b2Ms && `b2=${W.b2Ms}мс`].filter(Boolean).join(", ");
    console.log(`\nИтог e2e: ${results.length - failed}/${results.length} PASS${failed ? `, ${failed} FAIL` : ""}${timings ? ` (${timings})` : ""}` +
      (failed ? `\nСкриншоты падений: ${ARTIFACTS}` : ""));
    return { results, failed };
  } finally {
    try { if (W && W.quizTab && !W.quizTabClosed) await W.quizTab.close(); } catch (_) {}
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runE2E().then(({ failed }) => process.exit(failed ? 1 : 0))
    .catch(e => { console.error("ОШИБКА E2E:", (e && e.stack) || e); process.exit(2); });
}
