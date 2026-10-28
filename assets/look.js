/* Оформление: темы в одной цветовой гамме (фон, стекло, папки, кнопки) и персонаж-помощник.
   Палитры – по популярным сочетаниям для дизайна; четыре темы – на фонах, которые выбрала Любовь Игоревна.
   Цвета разделов курса (папок) берутся из палитры темы, поэтому папки всегда в гамме фона. */
(() => {
  const {esc, toast} = U;

  /* ---------- цвет ---------- */
  const rgb = h => { h = h.replace("#", ""); if (h.length === 3) h = h.replace(/./g, "$&$&"); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hex = a => "#" + a.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, k) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * k)); };
  const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const rgba = (h, a) => `rgba(${rgb(h).join(",")},${a})`;
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

  /* ---------- темы ---------- */
  // mode: светлая или тёмная тема; bg – пятна фона; folders – цвета папок по разделам
  const THEMES = [
    {k:"lavender", n:"Лаванда", mode:"light", base:"#efe8f8", bg:["#7b4cf5","#ee5fa8","#ffb37a","#7fd6c2"], ink:"#231a3a", accent:"#7b4cf5", accent2:"#ee5fa8", sun:"#ffd23f",
      folders:["#8b6cf0","#ee7fb4","#b48cf2","#f2a07c","#7fc8c0","#c77dd8","#9fa8f5","#e58fb0"]},
    {k:"hvoya", n:"Хвоя", mode:"dark", img:"assets/bg/hvoya.webp", base:"#173a24", bg:["#1f4a2a","#4f7f45","#9cbf7a","#d9e6a8"], ink:"#f2f6e6", accent:"#b7d98c", accent2:"#6f9c5a", sun:"#e9e48a",
      folders:["#4f7f45","#7da35f","#2f6a3c","#9cbf7a","#5c8a6a","#a8b86a","#3e7350","#c2cf8a"]},
    {k:"bordo", n:"Бордо", mode:"dark", img:"assets/bg/bordo.webp", base:"#4a0f1c", bg:["#5e1220","#8c2a35","#b85560","#e3a6a0"], ink:"#fbeff0", accent:"#f0a1a6", accent2:"#c4545f", sun:"#f3d29a",
      folders:["#a8323f","#c4545f","#8c2a35","#d9837f","#7a1f2e","#b8606a","#9e4250","#cf7b72"]},
    {k:"lemon", n:"Лимон", mode:"light", img:"assets/bg/lemon.webp", base:"#c9c9bd", bg:["#b5b6a6","#e9e6a0","#8c8d80","#f4f1c4"], ink:"#2c2d24", accent:"#6b6a2a", accent2:"#a39b3a", sun:"#ece27a",
      folders:["#d4c96a","#a8aa95","#e3dc8c","#8f907f","#c7bd55","#b9bba6","#e9e1a0","#9c9d8a"]},
    {k:"peach", n:"Персик", mode:"light", img:"assets/bg/peach.webp", base:"#f6cdb4", bg:["#e8765f","#f2a07a","#f6c99a","#e9b6a8"], ink:"#3d1d16", accent:"#c4513f", accent2:"#e8765f", sun:"#ffd08a",
      folders:["#e8765f","#f2a07a","#e39a8c","#f0b77c","#d4685a","#f4b39a","#e08a6c","#ebc08e"]},
    {k:"coast", n:"Побережье", mode:"light", base:"#dbd4cc", bg:["#7d929e","#0f3b59","#dba12c","#efe9e2"], ink:"#0f2335", accent:"#0f3b59", accent2:"#2e6a8f", sun:"#dba12c",
      folders:["#0f3b59","#7d929e","#dba12c","#4f7590","#3e251e","#b48a3a","#2d5878","#a3b1b9"]},
    {k:"still", n:"Натюрморт", mode:"dark", base:"#25271a", bg:["#343723","#7d2826","#898861","#4a2a1e"], ink:"#efe9d7", accent:"#e0a49c", accent2:"#898861", sun:"#e9d9a6",
      folders:["#7d2826","#898861","#9b4a3f","#5f613f","#a8a67c","#6e3a2c","#b46a5c","#77785a"]},
    {k:"gold", n:"Золото", mode:"light", base:"#ffedca", bg:["#f19502","#897523","#fffdf2","#e8c27a"], ink:"#250e02", accent:"#8a4a00", accent2:"#c27a06", sun:"#f19502",
      folders:["#f19502","#897523","#d9a83a","#b8742a","#a89040","#e0b35a","#7a6420","#efc070"]},
    {k:"galaxy", n:"Галактика", mode:"dark", base:"#16153a", bg:["#3d2645","#03045e","#c9184a","#89c2d9","#f49cbb"], ink:"#fff4f8", accent:"#f49cbb", accent2:"#89c2d9", sun:"#fbb02d",
      folders:["#c9184a","#89c2d9","#f49cbb","#bacdb0","#fbb02d","#7a5aa8","#3d6fb0","#d95f8a"]},
    {k:"sunset", n:"Закат", mode:"light", base:"#f7c8b0", bg:["#ffa67a","#cf4a4d","#dc7668","#572f48"], ink:"#3a1f30", accent:"#a8363a", accent2:"#572f48", sun:"#ffa67a",
      folders:["#cf4a4d","#dc7668","#ffa67a","#817965","#4e4c5e","#572f48","#e88a6e","#9a6a74"]},
    {k:"forest", n:"Лес", mode:"dark", base:"#182818", bg:["#213722","#41644a","#595082","#f8c662"], ink:"#f7f0dc", accent:"#f8c662", accent2:"#8a7fd0", sun:"#f8c662",
      folders:["#41644a","#595082","#c9a24e","#6f8f62","#7a6fb0","#2f5a3a","#a28a4a","#4f4878"]},
    {k:"cream", n:"Ваниль", mode:"dark", base:"#3a0a1c", bg:["#450c21","#a33e43","#75c3d1","#fbf2da"], ink:"#fbf2da", accent:"#9fd8e2", accent2:"#d9666b", sun:"#fbf2da",
      folders:["#a33e43","#4f9fae","#c96b6f","#6fb3c0","#7e2234","#8fbfa0","#b8545a","#3f8090"]},
    {k:"rose", n:"Пыльная роза", mode:"light", base:"#efe2c2", bg:["#795c5f","#a69658","#d9b26f","#fadf7f"], ink:"#3b2a2c", accent:"#6a4d50", accent2:"#a69658", sun:"#fadf7f",
      folders:["#795c5f","#a69658","#d9b26f","#c9a07a","#9c7f6e","#b8a560","#8a6a6c","#e2c27a"]},
    {k:"jelly", n:"Медуза", mode:"dark", base:"#0e2a5c", bg:["#043473","#28518a","#476998","#d7d6ae"], ink:"#f4f3e4", accent:"#d7d6ae", accent2:"#7f9cc8", sun:"#e9e7b0",
      folders:["#476998","#28518a","#8b9091","#6f8fbf","#b2b39d","#3a5f92","#9aa0a0","#5878a8"]},
    {k:"cherry", n:"Вишня", mode:"dark", base:"#3d0810", bg:["#640d14","#ad2831","#d8973c","#fd9bb7"], ink:"#f3e6bd", accent:"#fd9bb7", accent2:"#d8973c", sun:"#e8b260",
      folders:["#ad2831","#d8973c","#d96a8a","#8e1f28","#c27a3a","#e08aa0","#9a3a2a","#b85a70"]},
    {k:"emerald", n:"Изумруд", mode:"dark", base:"#111a19", bg:["#284139","#809076","#b86830","#f8d794"], ink:"#f6ecd0", accent:"#f8d794", accent2:"#c97a3f", sun:"#f8d794",
      folders:["#284139","#809076","#b86830","#4f6b5c","#a0a98f","#8a5a30","#3c5a4c","#c9a26a"]}
  ];
  const PHOTO = {k:"photo", n:"Своё фото"};

  /* ---------- палитра из своего фото ---------- */
  function paletteFrom(img){
    const c = document.createElement("canvas"); c.width = c.height = 48; const x = c.getContext("2d");
    x.drawImage(img, 0, 0, 48, 48); const d = x.getImageData(0, 0, 48, 48).data, px = [];
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i+1], d[i+2]]);
    let cen = [0, .2, .4, .6, .8].map(f => px[Math.floor(f * px.length)].slice());
    for (let it = 0; it < 8; it++){
      const sum = cen.map(() => [0, 0, 0, 0]);
      px.forEach(p => { let bi = 0, bd = 1e9; cen.forEach((q, i) => { const dd = (p[0]-q[0])**2 + (p[1]-q[1])**2 + (p[2]-q[2])**2; if (dd < bd){ bd = dd; bi = i; } }); const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
      cen = sum.map((s, i) => s[3] ? [s[0]/s[3], s[1]/s[3], s[2]/s[3], s[3]] : [...cen[i].slice(0, 3), 0]);
    }
    const cols = cen.sort((a, b) => b[3] - a[3]).map(c => hex(c.slice(0, 3)));
    const avg = hex(px.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]).map(v => v / px.length));
    const sat = h => { const [r, g, b] = rgb(h); return Math.max(r, g, b) - Math.min(r, g, b); };
    const dark = lum(avg) < .3, bySat = [...cols].sort((a, b) => sat(b) - sat(a));
    return {k:"photo", n:"Своё фото", mode: dark ? "dark" : "light", base: avg, bg: cols, ink: dark ? mix(cols.reduce((a, b) => lum(a) > lum(b) ? a : b), "#ffffff", .8) : mix(cols.reduce((a, b) => lum(a) < lum(b) ? a : b), "#000000", .7),
      accent: bySat[0], accent2: bySat[1] || bySat[0], sun: bySat.find(h => { const [r, g, b] = rgb(h); return r > 150 && g > 120 && b < 140; }) || "#ffd23f",
      folders: [...bySat, ...bySat.map(h => mix(h, "#ffffff", .25))]};
  }

  /* ---------- применить тему ---------- */
  const store = {get(k){ try{ return localStorage.getItem(k); }catch(_){ return null; } }, set(k, v){ try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch(_){ toast("Не хватает места в браузере."); } }};
  function themeOf(key){
    if (key === "photo"){ const p = store.get("oge-photo-pal"); if (p && store.get("oge-photo")) try{ return {...JSON.parse(p), img: store.get("oge-photo")}; }catch(_){} }
    return THEMES.find(t => t.k === key) || THEMES[0];
  }
  let current = THEMES[0];
  function applyTheme(key){
    const t = current = themeOf(key), dark = t.mode === "dark", h = document.documentElement, s = h.style;
    // акцент должен читаться на стекле: в тёмной теме светлее, в светлой – темнее
    let acc = t.accent; const surface = dark ? mix(t.base, "#000000", .3) : mix(t.base, "#ffffff", .6);
    for (let i = 0; i < 6 && contrast(acc, surface) < 4; i++) acc = mix(acc, dark ? "#ffffff" : "#000000", .2);
    const btnA = t.accent, btnB = t.accent2, btnInk = lum(mix(btnA, btnB, .5)) > .42 ? (dark ? mix(t.base, "#000000", .5) : t.ink) : "#ffffff";
    const tint = dark ? mix(t.base, "#000000", .15) : mix(t.base, "#ffffff", .55);
    const v = {
      "--base": t.base, "--ink": t.ink, "--muted": mix(t.ink, t.base, dark ? .32 : .38),
      "--line": dark ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.66)", "--hair": rgba(t.ink, dark ? .16 : .12),
      "--glass": rgba(tint, dark ? .38 : .44), "--glass-2": rgba(tint, dark ? .58 : .7),
      "--chip": rgba(dark ? "#ffffff" : t.ink, dark ? .12 : .07), "--field": dark ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.74)",
      "--violet": acc, "--pink": t.accent2, "--btn-a": btnA, "--btn-b": btnB, "--btn-ink": btnInk,
      "--sun": t.sun, "--sun-ink": lum(t.sun) > .4 ? "#2a2100" : "#ffffff",
      "--folder-ink": dark ? "#ffffff" : mix(t.ink, "#000000", .2),
      "--shadow": dark ? "0 18px 44px -18px rgba(0,0,0,.65), 0 2px 6px rgba(0,0,0,.25)" : `0 18px 44px -18px ${rgba(mix(t.accent, "#000000", .3), .35)}, 0 2px 6px ${rgba(t.ink, .06)}`,
      "--bg": t.img ? `${t.k === "photo" ? `linear-gradient(${rgba(t.base, .25)},${rgba(t.base, .25)}),` : ""}url("${t.img.startsWith("data:") ? t.img : new URL(t.img, document.baseURI).href}") center/cover no-repeat`
        : t.bg.slice(0, 4).map((c, i) => `radial-gradient(${["42% 38% at 12% 8%","40% 36% at 92% 14%","44% 40% at 80% 92%","38% 34% at 8% 88%"][i]}, ${rgba(c, dark ? .7 : .6)}, transparent 70%)`).join(",")
    };
    Object.entries(v).forEach(([k, x]) => s.setProperty(k, x));
    s.colorScheme = dark ? "dark" : "light";
    h.dataset.mode = t.mode; h.dataset.theme = t.k;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.base);
    // папки по разделам – из палитры темы; в тёмной теме слишком светлые цвета приглушаем
    const fold = t.folders.map(c => dark && lum(c) > .5 ? mix(c, t.base, .4) : c);
    Object.values(window.COURSES || {}).forEach(c => Object.values(c.blocks || {}).forEach((b, i) => { if (!b._orig) b._orig = b.color; b.color = fold[i % fold.length]; }));
    ownColor = fold[fold.length - 1];
  }
  let ownColor = "#8b5cf6";

  const swatch = t => t.img ? `url(${t.img})` : `radial-gradient(60% 60% at 20% 20%, ${t.bg[0]}, transparent), radial-gradient(60% 60% at 85% 30%, ${t.bg[1]}, transparent), radial-gradient(60% 60% at 60% 95%, ${t.bg[2]}, transparent), ${t.base}`;
  function themesHTML(cur){
    cur = cur || "lavender";
    return `<div class="themes" role="group" aria-label="Тема оформления">${[...THEMES, PHOTO].map(t => `<button type="button" class="theme-opt" data-theme-pick="${t.k}" aria-pressed="${cur === t.k}">
      <span style="background:${t.k === "photo" ? (store.get("oge-photo") ? `url(${store.get("oge-photo")}) center/cover` : "repeating-linear-gradient(45deg,#ddd 0 8px,#eee 8px 16px)") : swatch(t) + ";background-size:cover;background-position:center"}">
        ${t.folders ? `<i class="sw">${t.folders.slice(0, 4).map(c => `<em style="background:${c}"></em>`).join("")}</i>` : `<i class="sw plus">＋</i>`}</span><b>${t.n}</b></button>`).join("")}</div>
      <input type="file" accept="image/*" id="theme-photo" hidden>`;
  }
  /* своё фото: уменьшаем на устройстве, берём из него палитру; хранится только в этом браузере */
  function pickPhoto(cb){
    const inp = document.getElementById("theme-photo"); if (!inp) return;
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const img = new Image();
      img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = img.width * k; c.height = img.height * k; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        store.set("oge-photo", c.toDataURL("image/jpeg", .8)); store.set("oge-photo-pal", JSON.stringify(paletteFrom(img)));
        URL.revokeObjectURL(img.src); cb(); };
      img.src = URL.createObjectURL(f); };
    inp.click();
  }

  /* ---------- персонаж-помощник ---------- */
  const MASCOTS = [["kotik","Котик","assets/kotik.webp",true],["duck","Утёнок","assets/mascots/duck.webp"],["lamb","Овечка","assets/mascots/lamb.webp"],["hedgehog","Ёжик","assets/mascots/hedgehog.webp"]];
  let mascotKey = "kotik";
  function mascotInfo(){
    if (mascotKey === "own" && store.get("oge-mascot-img")) return {src: store.get("oge-mascot-img"), cut: store.get("oge-mascot-cut") === "1"};
    const m = MASCOTS.find(x => x[0] === mascotKey) || MASCOTS[0]; return {src: m[2], cut: !!m[3]};
  }
  function setMascot(key){
    mascotKey = key || "kotik"; if (mascotKey === "own" && !store.get("oge-mascot-img")) mascotKey = "kotik";
    document.documentElement.dataset.mascot = mascotInfo().cut ? "cut" : "photo";
    document.querySelectorAll("img[data-m]").forEach(i => i.src = mascotInfo().src);
  }
  const mascot = () => mascotInfo().src;
  function mascotsHTML(cur){
    cur = cur || "kotik"; const own = store.get("oge-mascot-img");
    return `<div class="mascots" role="group" aria-label="Персонаж-помощник">${MASCOTS.map(([k, n, src, cut]) => `<button type="button" class="mascot-opt" data-mascot-pick="${k}" aria-pressed="${cur === k}"><img src="${src}" alt="" class="${cut ? "" : "round"}"><b>${n}</b></button>`).join("")}
      <button type="button" class="mascot-opt" data-mascot-pick="own" aria-pressed="${cur === "own"}">${own ? `<img src="${own}" alt="" class="${store.get("oge-mascot-cut") === "1" ? "" : "round"}">` : `<span class="plus">＋</span>`}<b>${own ? "Свой" : "Загрузить"}</b></button></div>
      <input type="file" accept="image/*" id="mascot-file" hidden>`;
  }
  /* свой персонаж: если у картинки прозрачный фон (PNG) – показываем как наклейку, иначе в кружке */
  function pickMascot(cb){
    const inp = document.getElementById("mascot-file"); if (!inp) return;
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const img = new Image();
      img.onload = () => { const k = Math.min(1, 420 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = img.width * k; c.height = img.height * k; const x = c.getContext("2d"); x.drawImage(img, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height).data; let clear = 0; for (let i = 3; i < d.length; i += 16) if (d[i] < 200) clear++;
        const cut = clear > d.length / 16 * .08;
        store.set("oge-mascot-img", c.toDataURL(cut ? "image/png" : "image/jpeg", .85)); store.set("oge-mascot-cut", cut ? "1" : "0");
        URL.revokeObjectURL(img.src); cb(); };
      img.src = URL.createObjectURL(f); };
    inp.click();
  }

  Object.assign(U, {THEMES, applyTheme, themesHTML, pickPhoto, mascot, setMascot, mascotsHTML, pickMascot, ownColor: () => ownColor, theme: () => current});
  applyTheme("lavender"); setMascot("kotik");
})();
