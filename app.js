/* =========================================================
   카공픽 MVP — 지도 + 조건 필터 + 연동 목록 + 상세 정보
   빌드 도구 없이 동작하는 정적 웹앱 (Leaflet + OpenStreetMap)
   ========================================================= */
(function () {
  "use strict";

  // ---------------- 아이콘 ----------------
  const ICON = {
    plug: '<svg viewBox="0 0 24 24"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/></svg>',
    quiet: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>',
    table: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="4" rx="1.5"/><path d="M6 11v8M18 11v8"/></svg>',
    group: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5a4.5 4.5 0 0 1 4.5 4.5"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    laptop: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/></svg>',
    cup: '<svg viewBox="0 0 24 24"><path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
    nav: '<svg viewBox="0 0 24 24"><path d="m3 11 18-8-8 18-2-8-8-2Z"/></svg>',
    map: '<svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    review: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="m12 8 1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5L11 10l1-2Z"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/></svg>',
  };

  // ---------------- 필터 정의 ----------------
  const FILTERS = [
    { id: "outlets", label: "콘센트 있음", icon: ICON.plug, test: (c) => c.outlets === "yes" || c.outlets === "some" },
    { id: "quiet", label: "조용한 분위기", icon: ICON.quiet, test: (c) => c.quiet_level >= 2 },
    { id: "late", label: "늦게까지 영업", icon: ICON.moon, test: (c, ctx) => isLateToday(c, ctx.now) },
    { id: "open_now", label: "현재 영업 중", icon: ICON.clock, test: (c, ctx) => getOpenStatus(c, ctx.now).state === "open" },
  ];
  const LATE_MIN = 23 * 60; // 23:00 이후까지 영업하면 "늦게까지"

  const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const DAY_KO = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
  const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const QUIET_KO = { 1: "시끄러움", 2: "보통", 3: "매우 잔잔함" };
  const YN_KO = { yes: "있음", no: "없음", unknown: "정보 없음" };
  const OUTLET_KO = { yes: "대부분 좌석", some: "일부 좌석", no: "없음", unknown: "정보 없음" };

  // ---------------- 상태 ----------------
  const state = {
    data: null,
    region: null,
    query: "",
    active: new Set(),
    selectedId: null,
    userPos: null,
    view: "list", // list | detail
  };

  // ---------------- DOM ----------------
  const $ = (id) => document.getElementById(id);
  const el = {
    search: $("searchInput"), searchClear: $("searchClear"),
    region: $("regionSelect"), locate: $("locateBtn"),
    chips: $("chips"), count: $("resultCount"), reset: $("resetBtn"),
    panel: $("panel"), handle: $("sheetHandle"),
    listView: $("listView"), detailView: $("detailView"),
    list: $("cafeList"), empty: $("emptyState"), emptyReset: $("emptyResetBtn"),
    error: $("errorState"), sample: $("sampleNotice"),
    mapFallback: $("mapFallback"), toast: $("toast"),
  };
  const mq = window.matchMedia("(max-width: 899px)");
  const isMobile = () => mq.matches;

  // ---------------- 유틸 ----------------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const fmtMin = (min) => {
    const h = Math.floor(min / 60), m = min % 60;
    const label = (h >= 24 ? "새벽 " + String(h - 24).padStart(2, "0") : String(h).padStart(2, "0")) + ":" + String(m).padStart(2, "0");
    return min === 1440 ? "24:00" : label;
  };

  /** 한국 시간 기준 현재 요일/분 */
  function seoulNow() {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).reduce((a, p) => ((a[p.type] = p.value), a), {});
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    return { day, min: Number(parts.hour) * 60 + Number(parts.minute) };
  }

  function spansOf(cafe, dayIdx) {
    if (!cafe.hours) return null;
    const list = cafe.hours[DAY_KEYS[(dayIdx + 7) % 7]];
    return Array.isArray(list) ? list.map(([o, c]) => [toMin(o), toMin(c)]) : null;
  }

  /** 영업 상태: open | closed | unknown */
  function getOpenStatus(cafe, now) {
    const today = spansOf(cafe, now.day);
    if (today === null) return { state: "unknown", text: "영업시간 정보 없음" };
    if (today.length === 1 && today[0][0] === 0 && today[0][1] >= 1440) return { state: "open", text: "24시간 영업" };
    // 전날 자정 넘김 영업
    const prev = spansOf(cafe, now.day - 1) || [];
    for (const [, c] of prev) if (c > 1440 && now.min < c - 1440) return { state: "open", text: `영업 중 · ${fmtMin(c - 1440)}까지` };
    for (const [o, c] of today) if (now.min >= o && now.min < c) return { state: "open", text: `영업 중 · ${fmtMin(c)}까지` };
    const later = today.find(([o]) => o > now.min);
    if (later) return { state: "closed", text: `영업 전 · ${fmtMin(later[0])} 오픈` };
    if (today.length === 0) return { state: "closed", text: "오늘 휴무" };
    return { state: "closed", text: "영업 종료" };
  }

  function isLateToday(cafe, now) {
    const today = spansOf(cafe, now.day);
    if (!today || !today.length) return false;
    return Math.max(...today.map(([, c]) => c)) >= LATE_MIN;
  }

  function distanceM(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);
  function originPoint() {
    if (state.userPos) return { ...state.userPos, label: "내 위치에서" };
    const a = state.region.anchor;
    return { lat: a.lat, lng: a.lng, label: `${a.name}에서` };
  }

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), 3200);
  }

  // ---------------- 필터링 ----------------
  function computeResults() {
    const now = seoulNow();
    const q = norm(state.query);
    const origin = originPoint();
    const filters = FILTERS.filter((f) => state.active.has(f.id));
    return state.data.cafes
      .filter((c) => c.campus === state.region.id)
      .filter((c) => !q || norm(c.name).includes(q) || norm(c.address).includes(q))
      .filter((c) => filters.every((f) => f.test(c, { now })))
      .map((c) => ({ cafe: c, dist: distanceM(origin, c), status: getOpenStatus(c, now) }))
      .sort((a, b) => a.dist - b.dist);
  }

  // ---------------- 렌더: 칩 ----------------
  function renderChips() {
    el.chips.innerHTML = FILTERS.map((f) =>
      `<button type="button" class="chip" data-filter="${f.id}" aria-pressed="${state.active.has(f.id)}">${f.icon}${f.label}</button>`
    ).join("");
  }

  // ---------------- 렌더: 목록 ----------------
  function tagHtml(cafe) {
    const tags = [];
    if (cafe.zone && cafe.zone !== "북문") tags.push(`<span class="badge">${esc(cafe.zone)}</span>`);
    if (!hasCondInfo(cafe)) {
      tags.push(`<span class="badge unknown">공부 조건 확인 전</span>`);
      if (cafe.check_note) tags.push(`<span class="badge sample">현장 확인 필요</span>`);
      return tags.join("");
    }
    const yn = (v, label, icon) => {
      if (v === "yes") tags.push(`<span class="badge yes">${icon}${label}</span>`);
      else if (v === "unknown") tags.push(`<span class="badge unknown">${label} ?</span>`);
    };
    if (cafe.outlets === "some") tags.push(`<span class="badge yes">${ICON.plug}콘센트 일부</span>`);
    else yn(cafe.outlets, "콘센트", ICON.plug);
    if (cafe.quiet_level >= 2) tags.push(`<span class="badge yes">${ICON.quiet}${QUIET_KO[cafe.quiet_level]}</span>`);
    else if (cafe.quiet_level == null) tags.push(`<span class="badge unknown">소음 ?</span>`);
    else tags.push(`<span class="badge">${QUIET_KO[cafe.quiet_level]}</span>`);
    if (cafe.solo_seating === "yes") tags.push(`<span class="badge yes">1인석</span>`);
    if (cafe.partitions === "yes") tags.push(`<span class="badge yes">칸막이석</span>`);
    if (cafe.floor_seating === "yes") tags.push(`<span class="badge yes">좌식석</span>`);
    if (cafe.study_zone === "yes") tags.push(`<span class="badge yes">스터디존</span>`);
    if (cafe.wifi === "yes") tags.push(`<span class="badge yes">와이파이</span>`);
    if (cafe.last_verified_at) tags.push(`<span class="badge verified">${ICON.shield}현장 확인</span>`);
    if (cafe.check_note) tags.push(`<span class="badge sample">현장 확인 필요</span>`);
    return tags.join("");
  }

  /** "카카오맵 (2026-11-08 조회)" → "카카오맵 기준", "직접 확인 (…)" → "직접 확인" */
  function srcLabel(src) {
    const s = src.split(" (")[0];
    return /맵$/.test(s) ? `${s} 기준` : s;
  }

  let lastResults = [];
  function render() {
    const results = computeResults();
    lastResults = results;
    const ids = new Set(results.map((r) => r.cafe.id));
    const origin = originPoint();

    // 선택된 카페가 결과에서 빠지면 선택 해제
    if (state.selectedId && !ids.has(state.selectedId)) {
      state.selectedId = null;
      if (state.view === "detail") showList();
    }

    // 결과 수 / 초기화 버튼
    const total = state.data.cafes.filter((c) => c.campus === state.region.id).length;
    const filtered = state.active.size > 0 || state.query;
    el.count.innerHTML = filtered ? `<b>${results.length}</b>곳 / 전체 ${total}곳` : `<b>${total}</b>곳의 카페`;
    el.reset.hidden = !filtered;
    el.sample.hidden = !state.data.cafes.some((c) => !c.last_verified_at && c.campus === state.region.id);

    // 목록
    el.list.innerHTML = results.map(({ cafe, dist, status }) => `
      <li>
        <button type="button" class="cafe-card${cafe.id === state.selectedId ? " is-selected" : ""}" data-id="${esc(cafe.id)}">
          <div class="cafe-card-top">
            <h3 class="cafe-name">${esc(cafe.name)}</h3>
            <span class="cafe-dist">${fmtDist(dist)}</span>
          </div>
          <div class="cafe-sub">
            <span class="open-dot ${status.state}">${esc(status.text)}</span>
            ${cafe.hours && cafe.hours_status !== "verified" ? `<span class="unverified-mark">· ${cafe.hours_source ? esc(srcLabel(cafe.hours_source)) : "시간 미확인"}</span>` : ""}
          </div>
          <div class="tags">${tagHtml(cafe)}</div>
        </button>
      </li>`).join("");
    el.list.setAttribute("aria-label", `${origin.label} 가까운 순 카페 목록`);
    el.empty.hidden = results.length > 0;

    renderMarkers(results);
    if (state.view === "detail" && state.selectedId) renderDetail();
  }

  // ---------------- 렌더: 상세 ----------------
  /** "오늘 10:00 – 22:00 · 영업 중" 처럼 오늘 영업시간과 지금 상태 */
  function todayHoursText(cafe, now, status) {
    const spans = spansOf(cafe, now.day);
    if (spans === null) return "정보 없음";
    if (!spans.length) return "오늘 휴무";
    const range = spans.map(([o, c]) => `${fmtMin(o)} – ${fmtMin(c)}`).join(", ");
    return `오늘 ${range} · ${status.state === "open" ? "영업 중" : "영업 시간 아님"}`;
  }

  function condCell(label, icon, value, cls, wide = false) {
    if (wide) return `<div class="cond wide"><div class="cond-label">${icon}${label}</div><div class="cond-value ${cls}">${esc(value)}</div></div>`;
    return `<div class="cond"><div class="cond-label">${icon}${label}</div><div class="cond-value ${cls}">${esc(value)}</div></div>`;
  }

  function renderDetail() {
    const cafe = state.data.cafes.find((c) => c.id === state.selectedId);
    if (!cafe) return;
    const now = seoulNow();
    const status = getOpenStatus(cafe, now);
    const dist = distanceM(originPoint(), cafe);
    const ynCls = (v) => (v === "yes" || v === "no" ? v : "unknown");

    const groupText = cafe.group_seating === "yes" && cafe.group_capacity ? `있음 (최대 ${cafe.group_capacity}인)` : YN_KO[cafe.group_seating || "unknown"];
    const quietText = cafe.quiet_level == null ? "정보 없음" : QUIET_KO[cafe.quiet_level];
    const quietCls = cafe.quiet_level == null ? "unknown" : cafe.quiet_level >= 2 ? "yes" : "no";
    const outletCls = cafe.outlets === "some" ? "yes" : ynCls(cafe.outlets);

    const hoursRows = cafe.hours
      ? DAY_ORDER.map((d) => {
          const spans = cafe.hours[d];
          const txt = !Array.isArray(spans) ? "정보 없음" : spans.length ? spans.map(([o, c]) => `${fmtMin(toMin(o))} – ${fmtMin(toMin(c))}`).join(", ") : "휴무";
          const isToday = DAY_KEYS[now.day] === d;
          return `<tr class="${isToday ? "today" : ""}"><td>${DAY_KO[d]}${isToday ? " (오늘)" : ""}</td><td>${esc(txt)}</td></tr>`;
        }).join("")
      : "";

    const verified = !!cafe.last_verified_at;
    const srcText = cafe.source ? `<b>${esc(cafe.source)}</b>` : "등록된 출처";
    const verifyText = verified
      ? `${srcText}로 확인한 정보예요. 마지막 확인일 ${esc(cafe.last_verified_at)}`
      : `위치·주소는 ${srcText} 기준이에요. 공부 조건과 영업시간은 아직 <b>현장 확인 전</b>이니 방문 전에 한 번 더 확인해주세요.`;

    const kakaoUrl = cafe.kakao_map_url || `https://map.kakao.com/link/to/${encodeURIComponent(cafe.name)},${cafe.lat},${cafe.lng}`;
    const kakaoLabel = cafe.kakao_map_url ? "카카오맵" : "카카오맵 길찾기";
    const naverUrl = cafe.naver_map_url || `https://map.naver.com/p/search/${encodeURIComponent(cafe.name)}`;
    const naverBtn = `<a class="btn" href="${esc(naverUrl)}" target="_blank" rel="noopener">${ICON.map}${cafe.naver_map_url ? "네이버지도" : "네이버지도 검색"}</a>`;
    // 리뷰 링크: 장소 ID가 있으면 리뷰 탭으로 바로, 없으면 이름 검색
    const kakaoId = (cafe.kakao_map_url || "").match(/place\.map\.kakao\.com\/(\d+)/)?.[1];
    const naverId = (cafe.naver_map_url || "").match(/place\/(\d+)/)?.[1];
    const kakaoReviewUrl = kakaoId ? `https://place.map.kakao.com/${kakaoId}#review` : `https://map.kakao.com/?q=${encodeURIComponent(cafe.name)}`;
    const naverReviewUrl = naverId ? `https://m.place.naver.com/place/${naverId}/review/visitor` : `https://map.naver.com/p/search/${encodeURIComponent(cafe.name)}`;
    const placeLine =[cafe.zone, cafe.floor ? `${cafe.floor}층` : ""].filter(Boolean).join(" · ");

    const photos = cafe.photos || [];
    const photoBlock = photos.length
      ? `<div class="gallery" aria-label="${esc(cafe.name)} 사진 ${photos.length}장">
          ${photos.map((src, i) => `<button type="button" class="gallery-item" data-photo="${i}" aria-label="사진 ${i + 1} 크게 보기">
            <img src="${esc(src)}" alt="${esc(cafe.name)} 매장 사진 ${i + 1}" loading="lazy" /></button>`).join("")}
        </div>
        <p class="gallery-count">사진 ${photos.length}장 · 옆으로 넘겨보세요</p>`
      : `<div class="detail-photo"><span>사진 준비 중</span></div>`;

    el.detailView.innerHTML = `
      <article class="detail" aria-labelledby="detailTitle">
        <button type="button" class="detail-back" id="detailBack">${ICON.back}목록</button>
        ${photoBlock}
        <header class="detail-head">
          <h2 id="detailTitle">${esc(cafe.name)}</h2>
          <p class="addr">${esc(cafe.address)}${placeLine ? ` <span class="addr-extra">· ${esc(placeLine)}</span>` : ""}</p>
          <div class="meta-row">
            <span class="open-dot ${status.state}">${esc(status.text)}</span>
            <span class="cafe-dist">${esc(originPoint().label)} ${fmtDist(dist)}</span>
          </div>
          ${cafe.memo ? `<p class="detail-memo"><b>현장 메모</b> ${esc(cafe.memo)}</p>` : ""}
          ${cafe.check_note ? `<p class="detail-memo warn"><b>현장 확인 필요</b> ${esc(cafe.check_note)}</p>` : ""}
        </header>

        <h3 class="section-title">공부 조건</h3>
        <div class="cond-grid">
          ${condCell("시간", ICON.clock, todayHoursText(cafe, now, status), status.state === "open" ? "yes" : status.state === "closed" ? "no" : "unknown", true)}
          ${condCell("콘센트", ICON.plug, OUTLET_KO[cafe.outlets || "unknown"], outletCls)}
          ${condCell("소음", ICON.quiet, quietText, quietCls)}
          ${condCell("1인석", ICON.laptop, YN_KO[cafe.solo_seating || "unknown"], ynCls(cafe.solo_seating))}
          ${condCell("와이파이", ICON.info, YN_KO[cafe.wifi || "unknown"], ynCls(cafe.wifi))}
        </div>

        <h3 class="section-title">영업시간 ${cafe.hours && cafe.hours_status !== "verified" && !cafe.hours_source ? `<span class="unverified-mark">· 미확인</span>` : ""}</h3>
        ${cafe.hours ? `<table class="hours-table"><tbody>${hoursRows}</tbody></table>`
          : cafe.hours_invalid ? `<p class="hours-note">${esc(cafe.hours_raw)}</p>`
          : `<p class="hours-note">영업시간 정보가 아직 없어요.</p>`}
        ${cafe.hours && cafe.hours_source ? `<p class="hours-note">출처: ${esc(cafe.hours_source)} · 매장 사정에 따라 달라질 수 있어요.</p>` : ""}

        <h3 class="section-title">정보 신뢰도</h3>
        <div class="verify-box ${verified ? "ok" : ""}">${verified ? ICON.shield : ICON.info}<div>${verifyText}</div></div>

        <h3 class="section-title">길찾기</h3>
        <div class="link-row">
          <a class="btn primary" href="${esc(kakaoUrl)}" target="_blank" rel="noopener">${ICON.nav}${kakaoLabel}</a>
          ${naverBtn}
        </div>

        <h3 class="section-title">리뷰</h3>
        <div class="link-row">
          <a class="btn" href="${esc(kakaoReviewUrl)}" target="_blank" rel="noopener">${ICON.review}카카오맵 리뷰</a>
          <a class="btn" href="${esc(naverReviewUrl)}" target="_blank" rel="noopener">${ICON.review}네이버지도 리뷰</a>
        </div>
        <span class="report-link">정보가 다른가요? 수정 제보 기능은 곧 열릴 예정이에요.</span>
      </article>`;
    $("detailBack").addEventListener("click", () => { showList(); });
    el.detailView.querySelectorAll(".gallery-item").forEach((b) =>
      b.addEventListener("click", () => openLightbox(photos, Number(b.dataset.photo), cafe.name)));
  }

  // ---------------- 사진 크게 보기 ----------------
  function openLightbox(photos, index, name) {
    let i = index;
    const box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", `${name} 사진`);
    const draw = () => {
      box.innerHTML = `
        <img src="${esc(photos[i])}" alt="${esc(name)} 매장 사진 ${i + 1}" />
        <div class="lightbox-bar">
          <button type="button" data-nav="-1" aria-label="이전 사진" ${i === 0 ? "disabled" : ""}>${ICON.back}</button>
          <span>${i + 1} / ${photos.length}</span>
          <button type="button" data-nav="1" aria-label="다음 사진" class="next" ${i === photos.length - 1 ? "disabled" : ""}>${ICON.back}</button>
          <button type="button" data-close aria-label="닫기" class="close">닫기</button>
        </div>`;
    };
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
    const go = (d) => { const n = i + d; if (n >= 0 && n < photos.length) { i = n; draw(); } };
    const onKey = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1); };
    box.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav) { go(Number(nav.dataset.nav)); return; }
      if (e.target.closest("[data-close]") || e.target === box) close();
    });
    // 좌우로 밀어서 넘기기
    let sx = null;
    box.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); sx = null; });
    document.addEventListener("keydown", onKey);
    draw();
    document.body.appendChild(box);
  }

  // ---------------- 뷰 전환 ----------------
  function showDetail() {
    state.view = "detail";
    el.listView.hidden = true;
    el.detailView.hidden = false;
    renderDetail();
    el.detailView.scrollTop = 0;
  }
  function showList() {
    state.view = "list";
    el.detailView.hidden = true;
    el.listView.hidden = false;
    const card = state.selectedId && el.list.querySelector(`[data-id="${CSS.escape(state.selectedId)}"]`);
    if (card) card.scrollIntoView({ block: "nearest" });
  }

  function select(id, { pan = true } = {}) {
    state.selectedId = id;
    el.list.querySelectorAll(".cafe-card").forEach((c) => c.classList.toggle("is-selected", c.dataset.id === id));
    updateMarkerSelection();
    showDetail();
    if (isMobile() && el.panel.dataset.sheet === "peek") setSheet("half");
    if (pan) panTo(id);
  }

  function clearSelection() {
    state.selectedId = null;
    el.list.querySelectorAll(".cafe-card.is-selected").forEach((c) => c.classList.remove("is-selected"));
    updateMarkerSelection();
    showList();
  }

  // ---------------- 지도 ----------------
  let map = null, layer = null, meMarker = null;
  const markers = new Map();

  function initMap() {
    if (!window.L) {
      el.mapFallback.hidden = false;
      return;
    }
    map = L.map("map", { zoomControl: false, attributionControl: true }).setView([state.region.anchor.lat, state.region.anchor.lng], 17);
    L.control.zoom({ position: "topright" }).addTo(map);
    if (window.KAGONGPICK_NO_TILES) {
      // 외부 지도 이미지를 쓸 수 없는 환경: 격자 배경 위에 핀만 표시
      map.getContainer().classList.add("no-tiles");
      if (window.KAGONGPICK_ROADS) {
        drawStreets(window.KAGONGPICK_ROADS);
        map.attributionControl.setPrefix('도로 &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 기여자');
      } else {
        map.attributionControl.setPrefix("핀 위치는 실제 좌표 기준");
      }
    } else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, subdomains: "abc",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
    }
    layer = L.layerGroup().addTo(map);
    addAnchor();
    map.on("click", () => {
      if (state.selectedId) clearSelection();
      if (isMobile()) setSheet("peek");
    });
    map.on("zoomend", () => map.getContainer().classList.toggle("show-labels", map.getZoom() >= 18));
  }

  /** 지도 이미지 없이 OSM 도로 데이터로 거리를 그림 (아티팩트용) */
  function drawStreets(data) {
    const cs = getComputedStyle(document.documentElement);
    const col = (n) => cs.getPropertyValue(n).trim();
    map.createPane("streets").style.zIndex = 250;
    const renderer = L.canvas({ pane: "streets", padding: 0.5 });
    for (const ring of data.campus || []) {
      L.polygon(ring, { renderer, stroke: false, fillColor: col("--campus"), fillOpacity: 1, interactive: false }).addTo(map);
    }
    const style = { 1: [10, "--road-major"], 2: [8, "--road-major"], 3: [5, "--road"], 4: [3, "--road"] };
    const roads = (data.roads || []).slice().sort((a, b) => b.r - a.r);
    for (const r of roads) {
      const [weight, token] = style[r.r] || style[4];
      L.polyline(r.c, { renderer, color: col(token), weight, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
    }
    // 큰 길 이름: 이름마다 가장 긴 구간의 가운데에 한 번
    const longest = new Map();
    for (const r of roads) if (r.n && (!longest.has(r.n) || r.c.length > longest.get(r.n).c.length)) longest.set(r.n, r);
    for (const [name, r] of longest) {
      const mid = r.c[Math.floor(r.c.length / 2)];
      L.marker(mid, {
        icon: L.divIcon({ className: "road-label", html: `<span>${esc(name)}</span>`, iconSize: [0, 0] }),
        interactive: false, keyboard: false, zIndexOffset: -1000,
      }).addTo(map);
    }
  }

  let anchorMarker = null;
  function addAnchor() {
    if (!map) return;
    if (anchorMarker) anchorMarker.remove();
    const a = state.region.anchor;
    anchorMarker = L.marker([a.lat, a.lng], {
      icon: L.divIcon({ className: "", html: '<div class="anchor-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      interactive: false, keyboard: false, zIndexOffset: -100,
    }).bindTooltip(a.name, { permanent: true, direction: "bottom", offset: [0, 8], className: "anchor-label" }).addTo(map);
  }

  function pinHtml(cafe, status) {
    const lit = status.state === "open" ? "is-open" : status.state === "closed" ? "is-closed" : "";
    const cls = ["pin", lit, cafe.id === state.selectedId ? "is-selected" : ""].join(" ");
    return `<div class="${cls}"><div class="pin-body"></div><div class="pin-icon">${ICON.cup}</div><div class="pin-label">${esc(cafe.name)}</div></div>`;
  }

  /** 같은 좌표(같은 건물)에 있는 카페 핀을 겹치지 않게 옆으로 벌림 */
  function computeAnchors(results) {
    const groups = new Map();
    for (const { cafe } of results) {
      const key = `${cafe.lat.toFixed(6)},${cafe.lng.toFixed(6)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cafe.id);
    }
    const anchors = new Map();
    for (const ids of groups.values()) {
      ids.forEach((id, i) => {
        const dx = ids.length > 1 ? (i - (ids.length - 1) / 2) * 30 : 0;
        anchors.set(id, [17 - dx, 40]);
      });
    }
    return anchors;
  }
  let pinAnchors = new Map();

  function renderMarkers(results) {
    if (!map) return;
    layer.clearLayers();
    markers.clear();
    pinAnchors = computeAnchors(results);
    for (const { cafe, status } of results) {
      const m = L.marker([cafe.lat, cafe.lng], {
        icon: L.divIcon({ className: "pin-wrap" + (cafe.id === state.selectedId ? " selected" : ""), html: pinHtml(cafe, status), iconSize: [34, 42], iconAnchor: pinAnchors.get(cafe.id) }),
        title: cafe.name, alt: cafe.name, riseOnHover: true,
      });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); select(cafe.id); });
      m.addTo(layer);
      markers.set(cafe.id, { marker: m, cafe, status });
    }
  }

  function updateMarkerSelection() {
    for (const [id, { marker, cafe, status }] of markers) {
      const sel = id === state.selectedId;
      marker.setIcon(L.divIcon({ className: "pin-wrap" + (sel ? " selected" : ""), html: pinHtml(cafe, status), iconSize: [34, 42], iconAnchor: pinAnchors.get(id) || [17, 40] }));
      marker.setZIndexOffset(sel ? 1000 : 0);
    }
  }

  function panTo(id) {
    if (!map) return;
    const cafe = state.data.cafes.find((c) => c.id === id);
    if (!cafe) return;
    const size = map.getSize();
    if (!size.x || !size.y) return; // 지도가 화면에 안 보이는 상태면 이동하지 않음
    const zoom = Math.max(map.getZoom(), 17);
    const target = map.project([cafe.lat, cafe.lng], zoom);
    if (isMobile()) {
      // 바텀시트에 가리지 않도록 핀을 화면 위쪽으로 올림
      const visible = sheetVisiblePx();
      target.y += visible / 2;
    }
    map.flyTo(map.unproject(target, zoom), zoom, { duration: 0.45 });
  }

  // ---------------- 모바일 바텀시트 ----------------
  const SHEET_STATES = ["peek", "half", "full"];
  function sheetVisiblePx(name = el.panel.dataset.sheet) {
    const vh = window.innerHeight;
    return name === "peek" ? 148 : name === "half" ? vh * 0.52 : vh * 0.88;
  }
  function setSheet(name) {
    el.panel.dataset.sheet = name;
    el.handle.setAttribute("aria-expanded", String(name !== "peek"));
  }

  function initSheet() {
    let startY = 0, startVisible = 0, moved = false, dragging = false;
    el.handle.addEventListener("pointerdown", (e) => {
      if (!isMobile()) return;
      dragging = true; moved = false;
      startY = e.clientY;
      startVisible = sheetVisiblePx();
      el.panel.classList.add("dragging");
      el.handle.setPointerCapture(e.pointerId);
    });
    el.handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 5) moved = true;
      const maxV = window.innerHeight * 0.88;
      const visible = Math.min(maxV, Math.max(110, startVisible - dy));
      el.panel.style.transform = `translateY(${maxV - visible}px)`;
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      el.panel.classList.remove("dragging");
      el.panel.style.transform = "";
      if (!moved) {
        const i = SHEET_STATES.indexOf(el.panel.dataset.sheet);
        setSheet(SHEET_STATES[(i + 1) % SHEET_STATES.length]);
        return;
      }
      const visible = startVisible - (e.clientY - startY);
      const nearest = SHEET_STATES.reduce((best, s) => (Math.abs(sheetVisiblePx(s) - visible) < Math.abs(sheetVisiblePx(best) - visible) ? s : best), "peek");
      setSheet(nearest);
    };
    el.handle.addEventListener("pointerup", end);
    el.handle.addEventListener("pointercancel", end);
    // 목록을 스크롤하려고 하면 시트를 펼침
    el.listView.addEventListener("wheel", () => { if (isMobile() && el.panel.dataset.sheet === "peek") setSheet("half"); }, { passive: true });
    el.listView.addEventListener("touchstart", () => { if (isMobile() && el.panel.dataset.sheet === "peek") setSheet("half"); }, { passive: true });
  }

  // ---------------- 내 위치 ----------------
  function locate() {
    if (!("geolocation" in navigator)) { toast("이 브라우저에서는 위치 기능을 쓸 수 없어요. 지역 기준 거리로 보여드릴게요."); return; }
    el.locate.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        el.locate.disabled = false;
        state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        el.locate.classList.add("is-active");
        if (map) {
          if (meMarker) meMarker.remove();
          meMarker = L.marker([state.userPos.lat, state.userPos.lng], {
            icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
            interactive: false, keyboard: false,
          }).addTo(map);
          const far = distanceM(state.userPos, state.region.anchor) > 5000;
          if (far) toast(`현재 위치가 ${state.region.name}에서 멀어요. 거리는 내 위치 기준으로 표시돼요.`);
          else map.flyTo([state.userPos.lat, state.userPos.lng], 17, { duration: 0.5 });
        }
        render();
      },
      (err) => {
        el.locate.disabled = false;
        const msg = err.code === 1
          ? "위치 권한이 꺼져 있어요. 지도는 그대로 쓸 수 있고, 거리는 북문 기준으로 보여드려요."
          : "위치를 확인하지 못했어요. 잠시 후 다시 시도해주세요.";
        toast(msg);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  // ---------------- 이벤트 ----------------
  function bindEvents() {
    el.chips.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const id = btn.dataset.filter;
      state.active.has(id) ? state.active.delete(id) : state.active.add(id);
      btn.setAttribute("aria-pressed", String(state.active.has(id)));
      render();
    });

    let t;
    el.search.addEventListener("input", () => {
      el.searchClear.hidden = !el.search.value;
      clearTimeout(t);
      t = setTimeout(() => { state.query = el.search.value.trim(); render(); }, 120);
    });
    el.search.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && lastResults.length === 1) { select(lastResults[0].cafe.id); el.search.blur(); }
      if (e.key === "Escape") { el.search.value = ""; el.search.dispatchEvent(new Event("input")); }
    });
    el.searchClear.addEventListener("click", () => { el.search.value = ""; el.search.dispatchEvent(new Event("input")); el.search.focus(); });

    const resetAll = () => {
      state.active.clear(); state.query = ""; el.search.value = ""; el.searchClear.hidden = true;
      renderChips(); render();
    };
    el.reset.addEventListener("click", resetAll);
    el.emptyReset.addEventListener("click", resetAll);

    el.list.addEventListener("click", (e) => {
      const card = e.target.closest(".cafe-card");
      if (card) select(card.dataset.id);
    });

    el.region.addEventListener("change", () => {
      state.region = state.data.regions.find((r) => r.id === el.region.value);
      state.selectedId = null; showList();
      if (map) { addAnchor(); fitRegion(); }
      render();
    });

    el.locate.addEventListener("click", locate);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.view === "detail" && document.activeElement !== el.search) clearSelection();
    });

    mq.addEventListener("change", () => { setSheet("peek"); if (map) setTimeout(() => map.invalidateSize(), 50); });

    // 영업 상태는 분 단위로 변하므로 1분마다 갱신
    setInterval(render, 60 * 1000);
  }

  // ---------------- CSV 데이터 로딩 ----------------
  /** 따옴표·줄바꿈을 지원하는 CSV 파서 */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", i = 0, q = false;
    while (i < text.length) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
      i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift().map((h) => h.trim());
    return rows
      .filter((r) => r.some((v) => v.trim() !== ""))
      .map((r) => Object.fromEntries(header.map((h, j) => [h, (r[j] ?? "").trim()])));
  }

  /** 엑셀에서 저장한 CP949(EUC-KR) CSV도 읽을 수 있게 */
  function decodeText(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch { return new TextDecoder("euc-kr").decode(buf); }
  }

  const DAY_KO_TO_KEY = { 월: "mon", 화: "tue", 수: "wed", 목: "thu", 금: "fri", 토: "sat", 일: "sun" };
  /**
   * 영업시간 문자열 → 요일별 구간
   * 예) "매일 09:00-22:00" / "월-금 09:00-24:00; 토,일 11:00-23:00; 화 휴무" / "24시간"
   *     자정을 넘기면 "10:00-02:00" 처럼 써도 됩니다.
   */
  function parseHours(raw) {
    if (!raw) return null;
    const hours = {};
    const s = raw.trim();
    if (/^(매일\s*)?24시간$/.test(s)) { DAY_ORDER.forEach((d) => (hours[d] = [["00:00", "24:00"]])); return hours; }
    for (const part of s.split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
      const m = part.match(/^(매일|[월화수목금토일](?:\s*[-~,]\s*[월화수목금토일])*)\s+(.+)$/);
      if (!m) return null;
      let days = [];
      if (m[1] === "매일") days = DAY_ORDER.slice();
      else for (const seg of m[1].replace(/\s/g, "").split(",")) {
        const [a, b] = seg.split(/[-~]/);
        const ia = DAY_ORDER.indexOf(DAY_KO_TO_KEY[a]), ib = b ? DAY_ORDER.indexOf(DAY_KO_TO_KEY[b]) : ia;
        for (let k = ia; ; k = (k + 1) % 7) { days.push(DAY_ORDER[k]); if (k === ib) break; }
      }
      const time = m[2].trim();
      let spans;
      if (time === "휴무") spans = [];
      else if (time === "24시간") spans = [["00:00", "24:00"]];
      else {
        spans = [];
        for (const t of time.split(",")) {
          const tm = t.trim().match(/^(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})$/);
          if (!tm) return null;
          const o = +tm[1] * 60 + +tm[2];
          let c = +tm[3] * 60 + +tm[4];
          if (c <= o) c += 1440; // 자정 넘김
          const f = (x) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
          spans.push([f(o), f(c)]);
        }
      }
      days.forEach((d) => (hours[d] = spans));
    }
    return Object.keys(hours).length ? hours : null;
  }

  function parseYN(v) {
    const s = String(v || "").trim().toLowerCase();
    if (["yes", "y", "o", "있음", "가능", "true", "1"].includes(s)) return "yes";
    if (["no", "n", "x", "없음", "불가", "false", "0"].includes(s)) return "no";
    return "unknown";
  }
  /** 콘센트: yes(대부분 좌석) / some(일부 좌석) / no / unknown */
  function parseOutlets(v) {
    const s = String(v || "").trim().toLowerCase();
    if (["some", "일부", "partial"].includes(s)) return "some";
    return parseYN(s);
  }
  function parseQuiet(v) {
    const s = String(v || "").trim().toLowerCase();
    if (["3", "매우 잔잔함", "잔잔함", "독서실", "독서실 수준", "조용함", "quiet", "high"].includes(s)) return 3;
    if (["2", "보통", "normal", "mid"].includes(s)) return 2;
    if (["1", "시끄러움", "활기참", "loud", "low"].includes(s)) return 1;
    return null;
  }

  function rowToCafe(r, region) {
    const lat = parseFloat(r.lat), lng = parseFloat(r.lng);
    if (!r.name || !isFinite(lat) || !isFinite(lng)) return null;
    // 다인석: "yes" 또는 "yes:6" / "6" (가능 인원)
    const gs = String(r.group_seating || "");
    const gNum = gs.match(/(\d+)/);
    const hours = parseHours(r.hours);
    return {
      id: r.id || `${region.id}-${r.name}`,
      campus: region.id,
      name: r.name,
      zone: r.zone || "",
      address: r.address || "",
      floor: r.floor || "",
      lat, lng,
      naver_map_url: r.naver_map_url || null,
      kakao_map_url: r.kakao_map_url || null,
      hours,
      hours_raw: r.hours || "",
      hours_source: r.hours_source || "",
      hours_invalid: !!r.hours && !hours,
      // 영업시간 출처가 따로 적혀 있으면(카카오맵 등) 현장 확인 날짜와 별개로 그 출처를 보여줌
      hours_status: hours && r.last_verified_at && !r.hours_source ? "verified" : "unverified",
      outlets: parseOutlets(r.outlets),
      solo_seating: parseYN(r.solo_seating),
      partitions: parseYN(r.partitions),
      wifi: parseYN(r.wifi),
      floor_seating: parseYN(r.floor_seating),
      study_zone: parseYN(r.study_zone),
      memo: r.memo || "",
      quiet_level: parseQuiet(r.quiet_level),
      large_tables: parseYN(r.large_tables),
      group_seating: gNum ? "yes" : parseYN(gs),
      group_capacity: gNum ? Number(gNum[1]) : null,
      laptop_friendly: parseYN(r.laptop_friendly),
      photos: (r.photos || "").split("|").map((s) => s.trim()).filter(Boolean),
      source: r.source || "",
      source_id: r.source_id || "",
      last_verified_at: r.last_verified_at || null,
      check_note: r.check_note || "",
    };
  }

  async function loadData(config) {
    const cafes = [];
    for (const region of config.regions) {
      let rows;
      const inline = window.KAGONGPICK_INLINE_CSV && window.KAGONGPICK_INLINE_CSV[region.id];
      if (inline) rows = parseCSV(inline); // 단일 파일 배포(Claude 아티팩트)용
      else {
        const res = await fetch(region.csv, { cache: "no-cache" });
        if (!res.ok) throw new Error(`${region.csv} (${res.status})`);
        rows = parseCSV(decodeText(await res.arrayBuffer()));
      }
      for (const r of rows) { const c = rowToCafe(r, region); if (c) cafes.push(c); }
    }
    return { regions: config.regions, cafes };
  }

  function showLoadError(msg) {
    el.error.hidden = false;
    el.list.hidden = true;
    el.sample.hidden = true;
    el.count.textContent = "";
    if (msg) $("errorDesc").textContent = msg;
  }

  function hasCondInfo(c) {
    return [c.outlets, c.large_tables, c.group_seating, c.laptop_friendly, c.solo_seating, c.partitions, c.wifi].some((v) => v !== "unknown") || c.quiet_level != null;
  }

  function fitRegion() {
    if (!map) return;
    map.invalidateSize();
    const size = map.getSize();
    if (!size.x || !size.y) { setTimeout(fitRegion, 300); return; } // 화면에 아직 안 보이면 잠시 후 다시
    const pts = state.data.cafes.filter((c) => c.campus === state.region.id).map((c) => [c.lat, c.lng]);
    const a = state.region.anchor;
    pts.push([a.lat, a.lng]);
    const pad = isMobile() ? { paddingTopLeft: [20, 20], paddingBottomRight: [20, 160] } : { padding: [40, 40] };
    map.fitBounds(L.latLngBounds(pts), { ...pad, maxZoom: 17, animate: false });
  }

  // ---------------- 시작 ----------------
  async function init() {
    const config = window.KAGONGPICK_CONFIG;
    if (!window.L) el.mapFallback.hidden = false;
    if (!config || !config.regions?.length) { showLoadError("지역 설정(data/regions.js)을 찾지 못했어요."); return; }
    el.count.textContent = "카페 정보를 불러오는 중…";
    let data;
    try {
      data = await loadData(config);
    } catch (err) {
      console.error(err);
      showLoadError(location.protocol === "file:"
        ? "파일을 직접 열면 데이터를 읽을 수 없어요. serve.ps1로 서버를 켜고 열어주세요."
        : "네트워크 상태를 확인하고 다시 시도해주세요.");
      return;
    }
    state.data = data;
    state.region = data.regions[0];
    el.region.innerHTML = data.regions.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");

    renderChips();
    initMap();
    initSheet();
    bindEvents();
    setSheet("peek");
    render();
    fitRegion();
  }

  init();
})();
