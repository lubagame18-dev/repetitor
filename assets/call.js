/* Видеозвонок прямо на платформе: небольшое окно сбоку внизу, не мешает доске и материалам.
   Соединение напрямую между устройствами (WebRTC); сигналы – через Supabase Realtime.
   Если сеть не пропускает прямое соединение, в config.js можно добавить свой TURN-сервер (APP_CONFIG.TURN). */
window.Call = (() => {
  const {esc} = U;
  let st = null;
  const ice = () => {
    const turn = (window.APP_CONFIG && window.APP_CONFIG.TURN) || [];
    const relay = {urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject"};
    return {iceServers: [{urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"]}, relay, ...turn]};
  };

  async function getMedia(){
    const v = {width: {ideal: 640}, height: {ideal: 480}, facingMode: "user"};
    try{ return await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: v}); }catch(_){}
    try{ return await navigator.mediaDevices.getUserMedia({audio: true}); }catch(_){}
    return null;
  }

  /* room – общая «комната» звонка; me – свой id; onConnected(id) – когда собеседник подключился */
  async function join({sb, room, me, name, onConnected, onLeave}){
    if (st && st.room === room) return;
    if (st) leave(true);
    st = {sb, room, me, name, peers: new Map(), stream: null, ch: null, onConnected, onLeave, size: "small", mic: true, cam: true, status: "Включаю камеру…"};
    dock(); paint();
    st.stream = navigator.mediaDevices ? await getMedia() : null;
    if (!st) return;
    st.status = st.stream ? "Ждём собеседника…" : "Камера и микрофон недоступны – разрешите их в браузере. Пока вы только слышите и видите собеседника.";
    st.cam = !!st.stream?.getVideoTracks().length;
    if (!sb){ paint(); return; }
    st.ch = sb.channel("call-" + room, {config: {presence: {key: me}, broadcast: {self: false}}});
    st.ch.on("broadcast", {event: "sig"}, ({payload: m}) => onSignal(m)).subscribe(s => {
      if (s === "SUBSCRIBED"){ send({t: "hello"}); }
    });
    paint();
  }
  function send(m){ if (st?.ch) st.ch.send({type: "broadcast", event: "sig", payload: {...m, from: st.me, name: st.name}}).catch(() => {}); }

  function peer(id, name){
    let p = st.peers.get(id); if (p){ if (name) p.name = name; return p; }
    const pc = new RTCPeerConnection(ice());
    p = {pc, name: name || "", polite: st.me > id, makingOffer: false, ignore: false, stream: null, state: "connecting"};
    st.peers.set(id, p);
    if (st.stream) st.stream.getTracks().forEach(t => pc.addTrack(t, st.stream));
    else { pc.addTransceiver("audio", {direction: "recvonly"}); pc.addTransceiver("video", {direction: "recvonly"}); }
    pc.onicecandidate = e => { if (e.candidate) send({t: "ice", to: id, c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate}); };
    pc.ontrack = e => { p.stream = e.streams[0] || new MediaStream([e.track]); paint(); };
    pc.onnegotiationneeded = async () => {
      try{ p.makingOffer = true; await pc.setLocalDescription(); send({t: "sdp", to: id, d: {type: pc.localDescription.type, sdp: pc.localDescription.sdp}}); }
      catch(_){} finally{ p.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      if (p.state === "connected"){ st.status = ""; if (!p.told){ p.told = true; st.onConnected && st.onConnected(id, p.name); } }
      if (["failed", "closed"].includes(p.state)) drop(id);
      paint();
    };
    return p;
  }
  function drop(id){ const p = st?.peers.get(id); if (!p) return; try{ p.pc.close(); }catch(_){} st.peers.delete(id); if (!st.peers.size) st.status = "Собеседник отключился. Ждём…"; paint(); }

  async function onSignal(m){
    if (!st || !m || m.from === st.me || (m.to && m.to !== st.me)) return;
    if (m.t === "hello"){ peer(m.from, m.name); return; }     // новый участник: мы предлагаем соединение
    if (m.t === "bye"){ drop(m.from); return; }
    const p = peer(m.from, m.name), pc = p.pc;
    if (m.t === "sdp"){
      const collision = m.d.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
      p.ignore = !p.polite && collision; if (p.ignore) return;
      try{
        await pc.setRemoteDescription(m.d);
        if (m.d.type === "offer"){ await pc.setLocalDescription(); send({t: "sdp", to: m.from, d: {type: pc.localDescription.type, sdp: pc.localDescription.sdp}}); }
      }catch(_){}
    }
    if (m.t === "ice"){ try{ await pc.addIceCandidate(m.c); }catch(e){ if (!p.ignore){} } }
  }

  function leave(silent){
    if (!st) return;
    send({t: "bye"});
    st.peers.forEach((_, id) => drop(id));
    st.stream?.getTracks().forEach(t => t.stop());
    try{ st.ch && st.sb.removeChannel ? st.sb.removeChannel(st.ch) : st.ch?.unsubscribe?.(); }catch(_){}
    const cb = st.onLeave; st = null;
    document.getElementById("calldock")?.remove(); document.body.classList.remove("in-call");
    if (!silent && cb) cb();
  }

  /* окно звонка: живёт поверх страницы, страница под ним перерисовывается свободно */
  function dock(){
    let el = document.getElementById("calldock");
    if (!el){
      el = document.createElement("aside"); el.id = "calldock"; el.className = "calldock glass"; el.setAttribute("aria-label", "Видеозвонок");
      document.body.appendChild(el);
      el.addEventListener("click", e => {
        const b = e.target.closest("[data-call]"); if (!b || !st) return;
        const a = b.dataset.call;
        if (a === "mic"){ st.mic = !st.mic; st.stream?.getAudioTracks().forEach(t => t.enabled = st.mic); }
        if (a === "cam"){ st.cam = !st.cam; st.stream?.getVideoTracks().forEach(t => t.enabled = st.cam); }
        if (a === "size") st.size = st.size === "small" ? "large" : st.size === "large" ? "mini" : "small";
        if (a === "leave"){ leave(); return; }
        paint();
      });
    }
    return el;
  }
  function tile(id, stream, label, self){
    return `<figure class="cd-tile ${self ? "self" : ""}" data-tile="${esc(id)}"><video autoplay playsinline ${self ? "muted" : ""}></video>
      <figcaption>${esc(label)}</figcaption>${!stream || (self && !st.cam) ? `<span class="cd-ph" aria-hidden="true">${esc((label || "?")[0])}</span>` : ""}</figure>`;
  }
  function paint(){
    if (!st) return;
    const el = dock();
    el.dataset.size = st.size; document.body.classList.add("in-call");
    const others = [...st.peers.entries()];
    el.innerHTML = `<div class="cd-tiles">${others.map(([id, p]) => tile(id, p.stream, p.name || "Собеседник")).join("")}${tile("me", st.stream, "Вы", true)}</div>
      ${st.status ? `<p class="cd-status">${esc(st.status)}</p>` : ""}
      <div class="cd-bar">
        <button data-call="mic" aria-pressed="${!st.mic}" title="${st.mic ? "Выключить микрофон" : "Включить микрофон"}">${st.mic ? "🎤" : "🔇"}</button>
        <button data-call="cam" aria-pressed="${!st.cam}" title="${st.cam ? "Выключить камеру" : "Включить камеру"}" ${st.stream?.getVideoTracks().length ? "" : "disabled"}>${st.cam ? "📷" : "🚫"}</button>
        <button data-call="size" title="Размер окна">${st.size === "large" ? "▭" : st.size === "mini" ? "▢" : "⤢"}</button>
        <button data-call="leave" class="cd-end" title="Выйти из звонка">✕</button></div>`;
    el.querySelectorAll("[data-tile]").forEach(f => {
      const v = f.querySelector("video"), id = f.dataset.tile, s = id === "me" ? st.stream : st.peers.get(id)?.stream;
      if (s && v.srcObject !== s){ v.srcObject = s; v.play?.().catch(() => {}); }
    });
  }
  const active = () => !!st;
  const connected = () => !!st && [...st.peers.values()].some(p => p.state === "connected");
  const setSize = s => { if (st){ st.size = s; paint(); } };
  return {join, leave, active, connected, setSize};
})();
