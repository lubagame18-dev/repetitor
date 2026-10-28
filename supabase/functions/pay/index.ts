// Серверная функция «pay»: оплата подписки через ЮKassa.
//   create  – учитель нажал «Оплатить»: создаём платёж и отдаём ссылку на страницу оплаты
//   check   – учитель вернулся с оплаты: проверяем его последние платежи
//   уведомление ЮKassa (type = "notification") – платёж прошёл: продлеваем подписку на 30 дней
// Номер магазина и секретный ключ ЮKassa вводит разработчик в кабинете разработчика (хранятся на сервере).
// В настройках функции выключите «Verify JWT»: уведомления ЮKassa приходят без входа.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const PLAN_NAME: Record<string, string> = { basic: "Базовый", materials: "С материалами", full: "Полный с нейросетью" };
const DEFAULT_PRICES: Record<string, number> = { basic: 100, materials: 300, full: 500 };

async function shop() {
  const { data } = await admin.from("app_secrets").select("key,value").in("key", ["yk_shop", "yk_secret"]);
  const s = Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
  if (!s.yk_shop || !s.yk_secret) throw new Error("Оплата ещё не подключена: разработчик должен ввести данные ЮKassa.");
  return "Basic " + btoa(`${s.yk_shop}:${s.yk_secret}`);
}
async function prices() {
  const { data } = await admin.from("app_settings").select("value").eq("key", "prices").maybeSingle();
  return { ...DEFAULT_PRICES, ...(data?.value || {}) } as Record<string, number>;
}
/* платёж прошёл → продлеваем подписку (один раз на платёж) */
async function apply(p: any) {
  if (p?.status !== "succeeded" || !p.metadata?.teacher_id) return false;
  const { data: row } = await admin.from("payments").select("status").eq("id", p.id).maybeSingle();
  if (row?.status === "succeeded") return true;
  const tid = p.metadata.teacher_id, plan = p.metadata.plan;
  const { data: t } = await admin.from("teachers").select("paid_until, plan, trial").eq("id", tid).single();
  // если оплачен тот же тариф – добавляем 30 дней к текущему сроку; новый тариф – 30 дней с сегодняшнего дня
  const now = Date.now(), cur = t?.paid_until ? new Date(t.paid_until).getTime() : 0;
  const from = t && !t.trial && t.plan === plan && cur > now ? cur : now;
  await admin.from("teachers").update({ plan, paid_until: new Date(from + 30 * 864e5).toISOString(), trial: false }).eq("id", tid);
  await admin.from("payments").upsert({ id: p.id, teacher_id: tid, plan, amount: +p.amount.value, status: "succeeded", paid_at: new Date().toISOString() });
  return true;
}
async function fetchPayment(id: string) {
  const r = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(id)}`, { headers: { Authorization: await shop() } });
  return r.ok ? r.json() : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();

    // уведомление от ЮKassa: не верим телу, а запрашиваем платёж у ЮKassa
    if (body?.type === "notification") {
      const id = body.object?.id;
      if (id) { const p = await fetchPayment(id); if (p) await apply(p); }
      return new Response("ok", { status: 200 });
    }

    const auth = req.headers.get("Authorization") || "";
    const { data: u } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Нужно войти как учитель" }, 401);
    const uid = u.user.id;

    if (body.action === "create") {
      const plan = String(body.plan);
      const pr = await prices();
      if (!pr[plan]) return json({ error: "Нет такого тарифа" }, 400);
      const r = await fetch("https://api.yookassa.ru/v3/payments", {
        method: "POST",
        headers: { Authorization: await shop(), "Idempotence-Key": crypto.randomUUID(), "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: { value: pr[plan].toFixed(2), currency: "RUB" }, capture: true,
          confirmation: { type: "redirect", return_url: String(body.return_url || "") },
          description: `Подписка «${PLAN_NAME[plan]}» на 30 дней`,
          metadata: { teacher_id: uid, plan },
        }),
      });
      const p = await r.json();
      if (!r.ok) return json({ error: "ЮKassa: " + (p.description || r.status) }, 502);
      await admin.from("payments").insert({ id: p.id, teacher_id: uid, plan, amount: pr[plan], status: p.status });
      return json({ url: p.confirmation?.confirmation_url });
    }

    if (body.action === "check") {
      const { data: list } = await admin.from("payments").select("id").eq("teacher_id", uid).neq("status", "succeeded").order("created_at", { ascending: false }).limit(3);
      let ok = false;
      for (const x of list || []) { const p = await fetchPayment(x.id); if (p) { if (await apply(p)) ok = true; else await admin.from("payments").update({ status: p.status }).eq("id", x.id); } }
      return json({ ok });
    }
    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
