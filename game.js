(() => {
  "use strict";
  const ICONS = ["⭐", "🌙", "🍀", "🍓", "🦋", "🌸", "🍋", "🐸", "🍄", "🎈", "🐝", "🍒"];
  const LEVELS = [
    { name: "Prvi parovi", rows: 2, cols: 3 },
    { name: "Zagrevanje", rows: 3, cols: 4 },
    { name: "Kvadrat", rows: 4, cols: 4 },
    { name: "Širi sto", rows: 3, cols: 6 },
    { name: "Skoro sve", rows: 4, cols: 5 },
    { name: "Majstor", rows: 4, cols: 6 },
  ];
  const STORE = "webglow-memorija-v1";
  const $ = (id) => document.getElementById(id);

  function loadStore() {
    const def = { unlocked: 1, stars: [0, 0, 0, 0, 0, 0], bestMoves: [0, 0, 0, 0, 0, 0], bestTime: [0, 0, 0, 0, 0, 0], muted: false };
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!s) return def;
      return {
        unlocked: Math.max(1, Math.min(6, s.unlocked | 0) || 1),
        stars: Array.from({ length: 6 }, (_, i) => Math.max(0, Math.min(3, (s.stars && s.stars[i]) | 0))),
        bestMoves: Array.from({ length: 6 }, (_, i) => (s.bestMoves && s.bestMoves[i]) | 0),
        bestTime: Array.from({ length: 6 }, (_, i) => (s.bestTime && s.bestTime[i]) | 0),
        muted: !!s.muted,
      };
    } catch {
      return def;
    }
  }
  const store = loadStore();
  const save = () => localStorage.setItem(STORE, JSON.stringify(store));

  const audio = { ctx: null, muted: store.muted };
  function ac() {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
    }
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    return audio.ctx;
  }
  function beep(kind) {
    if (audio.muted) return;
    const c = ac();
    if (!c) return;
    const now = c.currentTime;
    const tone = (freq, dur, type, gain, at) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, at);
      g.gain.setValueAtTime(gain, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(at);
      o.stop(at + dur + 0.02);
    };
    if (kind === "flip") tone(420, 0.07, "triangle", 0.05, now);
    else if (kind === "match") tone(660, 0.09, "sine", 0.07, now), tone(880, 0.12, "sine", 0.07, now + 0.08);
    else if (kind === "miss") tone(220, 0.12, "sine", 0.04, now);
    else if (kind === "win") [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, "triangle", 0.08, now + i * 0.1));
    else if (kind === "click") tone(520, 0.05, "sine", 0.04, now);
  }
  function syncMute() {
    $("icon-on").hidden = audio.muted;
    $("icon-off").hidden = !audio.muted;
    $("btn-mute").setAttribute("aria-pressed", audio.muted ? "true" : "false");
    $("btn-mute").setAttribute("aria-label", audio.muted ? "Uključi zvuk" : "Utišaj zvuk");
  }

  const game = {
    mode: "title",
    index: 0,
    cards: [],
    open: [],
    locked: false,
    moves: 0,
    matched: 0,
    pairs: 0,
    started: false,
    startAt: 0,
    elapsed: 0,
    tick: null,
  };

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function starScore(pairs, moves) {
    if (moves <= pairs + 2) return 3;
    if (moves <= pairs * 2) return 2;
    return 1;
  }

  function showScreen(id) {
    ["screen-title", "screen-levels", "screen-pause", "screen-win"].forEach((s) => {
      const el = $(s);
      el.hidden = !id || s !== id;
    });
  }

  function fillLevels() {
    const grid = $("level-grid");
    grid.innerHTML = "";
    LEVELS.forEach((lv, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lvl";
      const locked = i + 1 > store.unlocked;
      if (locked) b.classList.add("locked");
      if (store.stars[i] > 0) b.classList.add("done");
      b.disabled = locked;
      const mark = locked ? "🔒" : store.stars[i] ? "★".repeat(store.stars[i]) + "☆".repeat(3 - store.stars[i]) : lv.rows + "×" + lv.cols;
      b.innerHTML = "<span>" + (i + 1) + "</span><small>" + mark + "</small>";
      b.setAttribute("aria-label", "Nivo " + (i + 1) + " " + lv.name + (locked ? " zaključan" : ""));
      b.addEventListener("click", () => {
        if (locked) return;
        beep("click");
        startLevel(i);
      });
      grid.appendChild(b);
    });
  }

  function updateHud() {
    const lv = LEVELS[game.index];
    $("hud-level").textContent = "Nivo " + (game.index + 1) + " · " + lv.name;
    $("hud-moves").textContent = "Potezi " + game.moves;
    $("hud-time").textContent = fmt(game.elapsed);
  }

  function stopTimer() {
    if (game.tick) {
      clearInterval(game.tick);
      game.tick = null;
    }
  }
  function startTimer() {
    if (game.started) return;
    game.started = true;
    game.startAt = Date.now() - game.elapsed;
    stopTimer();
    game.tick = setInterval(() => {
      if (game.mode !== "play") return;
      game.elapsed = Date.now() - game.startAt;
      $("hud-time").textContent = fmt(game.elapsed);
    }, 250);
  }


  function layoutBoard() {
    const board = $("board");
    const wrap = $("board-wrap");
    if (!wrap || wrap.hidden || game.mode === "title" || game.mode === "levels") return;
    const lv = LEVELS[game.index];
    const gap = window.matchMedia("(orientation:landscape) and (max-height:500px)").matches ? 6 : 8;
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    if (availW < 40 || availH < 40) return;
    const ca = 0.78;
    let w = (availW - (lv.cols - 1) * gap) / lv.cols;
    let h = w / ca;
    if (h * lv.rows + (lv.rows - 1) * gap > availH) {
      h = (availH - (lv.rows - 1) * gap) / lv.rows;
      w = h * ca;
    }
    board.style.gap = gap + "px";
    board.style.width = Math.floor(w * lv.cols + gap * (lv.cols - 1)) + "px";
    board.style.height = Math.floor(h * lv.rows + gap * (lv.rows - 1)) + "px";
  }

  function startLevel(index) {
    const lv = LEVELS[index];
    game.mode = "play";
    game.index = index;
    game.open = [];
    game.locked = false;
    game.moves = 0;
    game.matched = 0;
    game.pairs = (lv.rows * lv.cols) / 2;
    game.started = false;
    game.elapsed = 0;
    stopTimer();
    const icons = shuffle(ICONS).slice(0, game.pairs);
    game.cards = shuffle(icons.concat(icons)).map((icon, i) => ({ id: i, icon, open: false, matched: false }));
    const board = $("board");
    board.style.gridTemplateColumns = "repeat(" + lv.cols + ", minmax(0, 1fr))";
    board.style.gridTemplateRows = "repeat(" + lv.rows + ", minmax(0, 1fr))";
    $("board-wrap").hidden = false;
    board.innerHTML = "";
    game.cards.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card";
      btn.dataset.i = String(i);
      btn.setAttribute("aria-label", "Karta " + (i + 1));
      btn.innerHTML =
        '<div class="card-inner"><div class="face back"><span></span></div><div class="face front">' + c.icon + "</div></div>";
      btn.addEventListener("click", () => onFlip(i));
      board.appendChild(btn);
    });
    $("hud").hidden = false;
    showScreen(null);
    updateHud();
    requestAnimationFrame(layoutBoard);
  }

  function elCard(i) {
    return $("board").children[i];
  }

  function onFlip(i) {
    if (game.mode !== "play" || game.locked) return;
    const c = game.cards[i];
    if (c.open || c.matched) return;
    ac();
    startTimer();
    c.open = true;
    elCard(i).classList.add("open");
    beep("flip");
    game.open.push(i);
    if (game.open.length < 2) return;
    game.moves++;
    updateHud();
    const [a, b] = game.open;
    if (game.cards[a].icon === game.cards[b].icon) {
      game.cards[a].matched = game.cards[b].matched = true;
      elCard(a).classList.add("matched");
      elCard(b).classList.add("matched");
      elCard(a).setAttribute("aria-label", "Par " + game.cards[a].icon);
      elCard(b).setAttribute("aria-label", "Par " + game.cards[b].icon);
      game.open = [];
      game.matched++;
      beep("match");
      if (game.matched === game.pairs) finishWin();
    } else {
      game.locked = true;
      beep("miss");
      setTimeout(() => {
        game.cards[a].open = game.cards[b].open = false;
        elCard(a).classList.remove("open");
        elCard(b).classList.remove("open");
        game.open = [];
        game.locked = false;
      }, 700);
    }
  }

  function finishWin() {
    game.mode = "win";
    stopTimer();
    game.elapsed = game.started ? Date.now() - game.startAt : game.elapsed;
    const stars = starScore(game.pairs, game.moves);
    const i = game.index;
    if (stars > store.stars[i]) store.stars[i] = stars;
    if (!store.bestMoves[i] || game.moves < store.bestMoves[i]) store.bestMoves[i] = game.moves;
    if (!store.bestTime[i] || game.elapsed < store.bestTime[i]) store.bestTime[i] = game.elapsed;
    if (store.unlocked < i + 2) store.unlocked = Math.min(6, i + 2);
    save();
    const last = i === LEVELS.length - 1;
    $("w-title").textContent = last ? "Bravo!" : "Bravo!";
    $("win-stars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
    $("win-msg").textContent = last
      ? "Prošla si sve nivoe. Pamćenje ti sjaji!"
      : "Nivo „" + LEVELS[i].name + "“ je završen.";
    $("win-stats").textContent = "Potezi " + game.moves + " · vreme " + fmt(game.elapsed);
    $("btn-next").textContent = last ? "Izaberi nivo" : "Dalje";
    beep("win");
    showScreen("screen-win");
  }

  function goTitle() {
    game.mode = "title";
    stopTimer();
    $("board-wrap").hidden = true;
    $("hud").hidden = true;
    showScreen("screen-title");
  }
  function goLevels() {
    game.mode = "levels";
    stopTimer();
    $("board-wrap").hidden = true;
    $("hud").hidden = true;
    fillLevels();
    showScreen("screen-levels");
  }
  function pause() {
    if (game.mode !== "play") return;
    game.mode = "pause";
    if (game.started) game.elapsed = Date.now() - game.startAt;
    stopTimer();
    showScreen("screen-pause");
  }
  function resume() {
    if (game.mode !== "pause") return;
    game.mode = "play";
    showScreen(null);
    if (game.started) {
      game.startAt = Date.now() - game.elapsed;
      game.tick = setInterval(() => {
        if (game.mode !== "play") return;
        game.elapsed = Date.now() - game.startAt;
        $("hud-time").textContent = fmt(game.elapsed);
      }, 250);
    }
  }

  $("btn-play").addEventListener("click", () => {
    beep("click");
    ac();
    startLevel(Math.min(store.unlocked - 1, LEVELS.length - 1));
  });
  $("btn-levels").addEventListener("click", () => {
    beep("click");
    goLevels();
  });
  $("btn-levels-back").addEventListener("click", () => {
    beep("click");
    goTitle();
  });
  $("btn-resume").addEventListener("click", () => {
    beep("click");
    resume();
  });
  $("btn-restart").addEventListener("click", () => {
    beep("click");
    startLevel(game.index);
  });
  $("btn-pause-levels").addEventListener("click", () => {
    beep("click");
    goLevels();
  });
  $("btn-menu").addEventListener("click", () => pause());
  $("btn-next").addEventListener("click", () => {
    beep("click");
    if (game.index >= LEVELS.length - 1) goLevels();
    else startLevel(game.index + 1);
  });
  $("btn-win-levels").addEventListener("click", () => {
    beep("click");
    goLevels();
  });
  $("btn-mute").addEventListener("click", () => {
    audio.muted = !audio.muted;
    store.muted = audio.muted;
    save();
    syncMute();
    if (!audio.muted) {
      ac();
      beep("click");
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" || e.code === "KeyP") {
      if (game.mode === "play") pause();
      else if (game.mode === "pause") resume();
    }
  });

  window.Memorija = {
    startLevel,
    get mode() {
      return game.mode;
    },
    LEVELS,
  };

  window.addEventListener("resize", layoutBoard);
  window.addEventListener("orientationchange", () => setTimeout(layoutBoard, 200));

  syncMute();
  showScreen("screen-title");
})();
