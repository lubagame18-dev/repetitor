// Серверная функция «ai»: нейросеть для платформы репетитора + загрузка фото работ учеников.
// Ключи нейросети хранятся в таблице app_secrets (их вводит разработчик в кабинете разработчика) –
// на сайт они не попадают. Функция читает их служебным ключом, который Supabase даёт ей сам.
//
// Действия (поле action в теле запроса):
//   check_essay      – учитель: черновая оценка сочинения/изложения по критериям ОГЭ (учитель потом утверждает)
//   analyze_student  – учитель: разбор результатов ученика и предложения к плану
//   generate_tasks   – учитель: мини-практика и тест по теме урока
//   upload_work      – ученик: фото рукописной работы (по личному ключу ученика)
//   test_key         – разработчик: проверить, что ключ работает
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Провайдеры с OpenAI-совместимым API
const PROVIDERS: Record<string, { url: string; model: string }> = {
  deepseek:   { url: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", model: "deepseek/deepseek-chat" },
  aitunnel:   { url: "https://api.aitunnel.ru/v1/chat/completions", model: "deepseek-chat" },
  openai:     { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function secrets() {
  const { data } = await admin.from("app_secrets").select("key,value");
  return Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
}

async function ask(system: string, user: string, maxTokens = 1800) {
  const s = await secrets();
  const prov = s.ai_provider || "deepseek";
  const p = PROVIDERS[prov] || PROVIDERS.deepseek;
  const key = s[`key_${prov}`];
  if (!key) throw new Error(`Нет ключа для «${prov}». Его вводит разработчик в кабинете разработчика.`);
  const r = await fetch(s.ai_url || p.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: s.ai_model || p.model, temperature: 0.3, max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Нейросеть ответила ошибкой ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const out = await r.json();
  const txt: string = out.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(txt.replace(/^```(json)?|```$/g, "").trim()); }
  catch { return { raw: txt }; }
}

const RULES_OGE = `Ты – опытный эксперт ОГЭ по русскому языку (критерии 2027 года). Пиши по-русски, коротко и доброжелательно, обращайся к ученику на «ты» в поле comment.
Сочинение 13.1/13.2/13.3: СК1 (0–1) – ответ на вопрос/тезис; СК2 (0–4) – два примера из текста с пояснениями и указанием их смысловой связи (примеры только из текста, у каждого – пояснение; без пояснения пример не засчитывается); СК3 (0–2) – логичность; СК4 (0–1) – композиционная стройность. Если менее 70 слов – 0 баллов за всё.
Сжатое изложение: ИК1 (0–2) – три микротемы; ИК2 (0–3) – приёмы сжатия; ИК3 (0–1) – смысловая цельность и последовательность.
Грамотность считай отдельно: число орфографических (orf), пунктуационных (punct), грамматических (gram) и речевых (speech) ошибок, и фактических (fact).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const action = body.action as string;

    // ---------- ученик: фото работы ----------
    if (action === "upload_work") {
      if (String(body.code || "").length < 32) return json({ error: "Вход устарел" }, 401);
      const { data: srow } = await admin.from("students").select("id").eq("access_token", body.code).maybeSingle();
      const sid = srow?.id;
      if (!sid) return json({ error: "Вход устарел" }, 401);
      const b64 = String(body.data || "").replace(/^data:image\/\w+;base64,/, "");
      if (b64.length > 7_000_000) return json({ error: "Фото слишком большое" }, 400);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `${sid}/${String(body.lesson).replace(/[^\w-]/g, "")}-${Date.now()}.jpg`;
      const { error } = await admin.storage.from("works").upload(path, bytes, { contentType: "image/jpeg" });
      if (error) throw error;
      return json({ url: admin.storage.from("works").getPublicUrl(path).data.publicUrl });
    }

    // ---------- дальше – только вошедший учитель ----------
    const auth = req.headers.get("Authorization") || "";
    const { data: u } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Нужно войти как учитель" }, 401);
    const uid = u.user.id;
    const { data: me } = await admin.from("teachers").select("role").eq("id", uid).single();
    if (!me) return json({ error: "Нет профиля учителя" }, 403);
    // тарифы: анализ и план – от 300 ₽ (materials), проверка сочинений и задания – 500 ₽ (full)
    const { data: plan } = await admin.rpc("plan_active", { uid });
    const need: Record<string, string[]> = { analyze_student: ["materials", "full"], check_essay: ["full"], generate_tasks: ["full"], test_key: ["full"] };
    if (need[action] && !need[action].includes(plan as string))
      return json({ error: plan ? "Эта функция нейросети входит в тариф " + (need[action][0] === "full" ? "«Полный» (500 ₽ в месяц)" : "от 300 ₽ в месяц") + "." : "Подписка закончилась – продлите её в разделе «Подписка»." }, 402);
    const own = async (sid: string) => {
      const { data } = await admin.from("students").select("*").eq("id", sid).eq("teacher_id", uid).single();
      if (!data) throw new Error("Это не ваш ученик");
      return data;
    };

    if (action === "test_key") {
      if (me.role !== "developer") return json({ error: "Только разработчик" }, 403);
      const r = await ask("Ответь JSON.", 'Верни {"ok":true,"hello":"Привет"}', 50);
      return json(r);
    }

    if (action === "check_essay") {
      const st = await own(body.student_id);
      const { data: w } = await admin.from("writings").select("*").eq("student_id", st.id).eq("lesson_id", body.lesson_id).single();
      if (!w) return json({ error: "Работа не найдена" }, 404);
      const isIzl = w.kind === "izl";
      const res = await ask(RULES_OGE + `\nВерни строго JSON: {"scores":{${isIzl ? '"ИК1":0,"ИК2":0,"ИК3":0' : '"СК1":0,"СК2":0,"СК3":0,"СК4":0'}},"errors":{"orf":0,"punct":0,"gram":0,"speech":0,"fact":0},"found":[{"fragment":"…","type":"orf|punct|gram|speech|fact|logic","fix":"…"}],"strengths":"…","comment":"2–4 предложения ученику: что получилось и что исправить"}`,
        `Тип работы: ${w.kind}. ${body.topic ? "Тема: " + body.topic : ""}\n${body.source ? "Исходный текст:\n" + String(body.source).slice(0, 6000) + "\n" : ""}\nРабота ученика (${w.words || "?"} слов):\n${String(w.body || "").slice(0, 8000)}`);
      await admin.from("writings").update({ ai: res }).eq("student_id", st.id).eq("lesson_id", body.lesson_id);
      return json(res);
    }

    if (action === "analyze_student") {
      const st = await own(body.student_id);
      const [{ data: res }, { data: wr }, { data: act }, { data: hw }] = await Promise.all([
        admin.from("results").select("lesson_id,kind,score,total,wrong,duration_sec,created_at").eq("student_id", st.id).order("created_at"),
        admin.from("writings").select("lesson_id,kind,total,max,errors,status").eq("student_id", st.id),
        admin.from("activity").select("lesson_id,day,seconds").eq("student_id", st.id),
        admin.from("homework").select("lesson_id,status").eq("student_id", st.id),
      ]);
      const r = await ask(`Ты – методист-репетитор по русскому языку. Проанализируй успехи ученика и предложи гибкую корректировку плана.
Методика уроков: теория маленькими блоками → объяснение на примерах → мини-практика сразу после блока → снова теория → в конце задания формата ОГЭ/ЕГЭ.
Верни строго JSON: {"summary":"3–5 предложений для учителя","strengths":["…"],"weak":[{"topic":"…","why":"по каким данным видно"}],"time":"вывод о времени занятий и полноте выполнения","plan":[{"title":"название урока повторения или нового урока","why":"…","tasks":["что делать на уроке"]}],"essay":"вывод по сочинениям/изложениям"}. В plan – не больше 4 пунктов.`,
        JSON.stringify({ ученик: { класс: st.grade, цели: st.goals, курс: st.course }, план_уроков: body.lessons || [], результаты: res, письменные: wr, время: act, дз: hw, входной_тест_слабые_темы: body.entry_weak || [] }).slice(0, 24000), 2200);
      await admin.from("ai_reports").insert({ teacher_id: uid, student_id: st.id, kind: "analysis", body: r });
      return json(r);
    }

    if (action === "generate_tasks") {
      const n = Math.min(Math.max(+body.count || 5, 2), 12);
      const r = await ask(`Ты – учитель русского языка. Составь задания строго по теме, на уровне ${body.grade || 9} класса${body.exam ? ", в духе заданий " + body.exam : ""}. Примеры – свои, не копируй задания из сборников.
Мини-практика – короткие вопросы с однословным ответом (варианты верного ответа через «|»; если ответ – ударение, ударную гласную пиши заглавной). Тест – 4 варианта, один верный, a – индекс верного (0–3), e – короткое объяснение, tag – тема.
Верни строго JSON: {"title":"…","mini":[{"q":"…","a":"…"}],"test":[{"q":"…","o":["…","…","…","…"],"a":0,"e":"…","tag":"…"}]}`,
        `Тема: ${body.topic}. ${body.notes ? "Пожелания: " + body.notes : ""} Мини-практика: ${n} заданий. Тест: ${n} вопросов.`, 2600);
      return json(r);
    }

    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
