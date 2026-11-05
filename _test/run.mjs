/* Полный прогон проверок repetitor (v57): мок Supabase без браузера + стенд доски + e2e (учитель+ученик).
   Запуск: node _test/run.mjs
           PORT=... CDP_PORT=... node _test/run.mjs   (базовые порты переопределяются для доски)
   Печатает PASS/FAIL каждого набора, скриншоты падений — в _test/artifacts/.
   Код выхода: 0 — всё зелёное, 1 — есть падения, 2 — стенд не запустился.
   Наборы идут последовательно, каждый поднимает/гасит свои сервер и Chrome:
     mock-selftest.mjs — мок (RPC/from/channel/quiz_*), без браузера;
     board.mjs         — доска, 15 сценариев (board.html);
     e2e.mjs           — a,b1,b2,b3 + Q1–Q4 на mock Supabase (teacher.html + index.html). */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function runFile(file, extraEnv) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [file], { cwd: path.dirname(__dirname), stdio: "inherit", env: { ...process.env, ...(extraEnv || {}) } });
    let done = false;
    const finish = code => { if (done) return; done = true; resolve(code == null ? 1 : code); };
    p.on("error", e => { console.error("Не удалось запустить " + file + ": " + e.message); finish(2); });
    p.on("close", finish);
  });
}

async function main() {
  // старые скриншоты падений не должны путать: чистим только свою папку артефактов
  try { fs.rmSync(path.join(__dirname, "artifacts"), { recursive: true, force: true }); } catch (_) {}
  const suites = [
    ["Мок Supabase (без браузера)", path.join(__dirname, "mock-selftest.mjs")],
    ["Доска (стенд board.html)", path.join(__dirname, "board.mjs")],
    ["E2E (учитель + ученик, mock Supabase)", path.join(__dirname, "e2e.mjs"), { E2E_ONLY: "a,b1,b2,b3,Q1,Q2,Q3,Q4,Q5,Q6,S1,S2,S3,S4,T1,T2,T3,T4,U2" }],
    /* U1 отдельно: вкладки делят localStorage, и в одном процессе сессия rowB может перетереть rowA */
    ["E2E (U1: база самообучения и конструктор)", path.join(__dirname, "e2e.mjs"), { E2E_ONLY: "U1" }],
  ];
  const results = [];
  for (const [name, file, extraEnv] of suites) {
    console.log("\n══════════ " + name + " ══════════");
    if (!fs.existsSync(file)) { console.error("Нет файла: " + file); results.push([name, 2]); continue; }
    const code = await runFile(file, extraEnv);
    results.push([name, code]);
  }
  console.log("\n══════════ ИТОГ ══════════");
  let bad = false;
  results.forEach(([name, code]) => {
    const mark = code === 0 ? "PASS" : "FAIL";
    if (code !== 0) bad = true;
    console.log(`[${mark}] ${name}${code === 0 ? "" : ` (exit ${code})`}`);
  });
  if (bad) console.log("Скриншоты падений: " + path.join(__dirname, "artifacts"));
  process.exit(bad ? 1 : 0);
}

main();
