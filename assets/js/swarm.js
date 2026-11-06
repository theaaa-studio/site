/**
 * Swarm — an original "multiplayer cursors rebuild the page" effect.
 *
 * Guided Tour Architecture (2x Fast Pacing):
 *   1. All HTML content loaded in background.
 *   2. Sections initialize in pending state (hidden in DOM, layout preserved).
 *   3. Auto-scroll follows the rebuild: Swarm builds section -> smooth scrolls
 *      to next section -> builds next section, all the way down the page at 2x speed.
 *   4. When the whole site is done, smooth scrolls all the way back to top!
 *   5. Instant "Skip" option always available in toolbar and via Escape key.
 *
 * Public API:
 *   Swarm.init({ root })                 -> initialize and run tour
 *   Swarm.play({ root })                 -> alias for init
 *   Swarm.skip()                         -> reveal everything immediately
 *   Swarm.replay()                       -> reset and restart tour from top
 *   Swarm.triggerSectionById(id)         -> jump tour to specific section
 *   Swarm.isRunning()                    -> boolean
 */
(function () {
  "use strict";

  const NAMES = ["Designer", "Dev", "AAA", "Artist", "XR", "QA", "Tech Art", "PM", "Frontend", "3D", "Audio", "Writer"];
  const COLORS = ["#6d28d9", "#0891b2", "#e11d48", "#16a34a", "#f59e0b", "#2563eb", "#db2777", "#0d9488", "#7c3aed", "#0284c7", "#ea580c", "#059669"];
  const SPEEDS = [1, 2, 3];
  const CANCEL = Symbol("swarm-cancel");

  const CURSOR_SVG =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
    '<path d="M3 2.5 20.5 10l-7.4 2.2L10 19.8Z" fill="currentColor" stroke="#fff" ' +
    'stroke-width="1.6" stroke-linejoin="round"/></svg>';

  /* ------------------------------------------------------------------ */
  /* Shared state                                                       */
  /* ------------------------------------------------------------------ */

  const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  window.addEventListener(
    "pointermove",
    (e) => {
      mouse.x = e.clientX + window.scrollX;
      mouse.y = e.clientY + window.scrollY;
    },
    { passive: true }
  );

  let activeRun = null;
  let speedIndex = Math.max(0, SPEEDS.indexOf(Number(localStorage.getItem("swarmSpeed")) || 1));
  const getSpeed = () => SPEEDS[speedIndex];

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  const el = (tag, cls, parent) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function alphaOf(color) {
    if (!color || color === "transparent") return 0;
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length > 3 ? parseFloat(parts[3]) : 1;
  }

  function ownText(node) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3 && c.textContent.trim()) return true;
    }
    return false;
  }

  function hasBox(cs) {
    const borderW =
      parseFloat(cs.borderTopWidth) + parseFloat(cs.borderRightWidth) +
      parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderLeftWidth);
    return (
      alphaOf(cs.backgroundColor) > 0.02 ||
      (cs.backgroundImage && cs.backgroundImage !== "none") ||
      (borderW > 0 && alphaOf(cs.borderTopColor) > 0.02) ||
      (cs.boxShadow && cs.boxShadow !== "none")
    );
  }

  function friendlyName(section) {
    const id = section.id || "";
    if (id === "home") return "Hero";
    if (id === "islamic-project") return "Featured Project";
    if (id === "tools") return "Tools";
    if (id === "games") return "Games";
    if (id === "about") return "About";
    if (id === "technology") return "Tech Stack";
    if (id === "experience") return "Experience";
    if (id === "extra") return "Highlights";
    if (id === "thanks") return "Closing";
    return id || "Section";
  }

  /* ------------------------------------------------------------------ */
  /* Snapshot a Single Section                                          */
  /* ------------------------------------------------------------------ */

  function snapshotSection(sectionEl) {
    const sx = window.scrollX;
    const sy = window.scrollY;
    const tasks = [];
    const byEl = new Map();

    const walker = document.createTreeWalker(sectionEl, NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.closest("[aria-hidden='true']")) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BR)$/i.test(n.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const consider = (node) => {
      if (!node || node === sectionEl) return;

      if (/^(MAIN|SECTION|BODY|HTML)$/i.test(node.tagName) || node.id === "dynamic-content") return;
      if (
        node.classList.contains("container") ||
        node.classList.contains("grid") ||
        node.classList.contains("cards") ||
        node.classList.contains("hero-wrap") ||
        node.classList.contains("project-wrap") ||
        node.closest(".glow")
      ) {
        return;
      }

      const cs = getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return;
      const rect = node.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;

      const isImg = /^(IMG|SVG|CANVAS|VIDEO|PICTURE)$/i.test(node.tagName);
      const box = !isImg && hasBox(cs);
      const text = !isImg && ownText(node) ? node.innerText.trim().replace(/\s+/g, " ") : "";
      if (!isImg && !box && !text) return;

      let parent = null;
      for (let p = node.parentElement; p && p !== sectionEl; p = p.parentElement) {
        if (byEl.has(p)) { parent = byEl.get(p); break; }
      }

      const bw = (side) => parseFloat(cs["border" + side + "Width"]) || 0;
      const pad = (side) => parseFloat(cs["padding" + side]) || 0;
      const padLeft = bw("Left") + pad("Left");
      const padTop = bw("Top") + pad("Top");
      const padRight = bw("Right") + pad("Right");

      const task = {
        el: node,
        parent,
        isImg,
        box,
        text,
        cs,
        x: rect.left + sx,
        y: rect.top + sy,
        w: rect.width,
        h: rect.height,
        content: {
          x: rect.left + sx + padLeft,
          y: rect.top + sy + padTop,
          w: Math.max(10, rect.width - padLeft - padRight),
          padLeft,
          padTop,
          padRight,
        },
        border: bw("Top") > 0 && alphaOf(cs.borderTopColor) > 0.02,
        state: "pending",
      };
      byEl.set(node, task);
      tasks.push(task);
    };

    let n;
    while ((n = walker.nextNode())) {
      consider(n);
    }

    tasks.sort((a, b) => {
      if (a.parent === b) return 1;
      if (b.parent === a) return -1;
      return a.y - b.y;
    });

    return tasks;
  }

  /* ------------------------------------------------------------------ */
  /* Run Lifecycle                                                      */
  /* ------------------------------------------------------------------ */

  function createRun(root) {
    const r = {
      root,
      cancelled: false,
      sections: [],
      buildingSection: null,
      agents: [],
      waiters: new Set(),
      signals: [],
      raf: 0,
      last: 0,
      layer: null,
      canvas: null,
      toolbar: null,
      focus: {
        x: window.innerWidth / 2 + window.scrollX,
        y: window.scrollY + window.innerHeight / 2,
      },
    };

    r.guard = (executor) =>
      new Promise((resolve, reject) => {
        if (r.cancelled) return reject(CANCEL);
        const entry = { reject };
        r.waiters.add(entry);
        executor(
          (v) => { r.waiters.delete(entry); resolve(v); },
          (e) => { r.waiters.delete(entry); reject(e); },
          entry
        );
      });

    r.wait = (ms) =>
      r.guard((res, _rej, entry) => {
        const id = setTimeout(res, Math.max(8, ms / getSpeed()));
        entry.cleanup = () => clearTimeout(id);
      });

    r.tween = (ms, fn) =>
      r.guard((res, _rej, entry) => {
        let elapsed = 0;
        let prev = performance.now();
        let id = 0;
        const duration = Math.max(15, ms / getSpeed());
        const step = (now) => {
          elapsed += now - prev;
          prev = now;
          const t = Math.min(1, elapsed / duration);
          fn(ease(t), t);
          if (t >= 1) return res();
          id = requestAnimationFrame(step);
        };
        id = requestAnimationFrame(step);
        entry.cleanup = () => cancelAnimationFrame(id);
      });

    r.nextSignal = () => r.guard((res) => r.signals.push(res));
    r.signal = () => {
      const s = r.signals.splice(0);
      s.forEach((fn) => fn());
    };

    r.cancel = () => {
      r.cancelled = true;
      r.waiters.forEach((w) => {
        if (w.cleanup) w.cleanup();
        w.reject(CANCEL);
      });
      r.waiters.clear();
    };

    return r;
  }

  /* ------------------------------------------------------------------ */
  /* Agent Setup & Physics (2x Faster Speed)                            */
  /* ------------------------------------------------------------------ */

  function createAgent(r, i, start) {
    const color = COLORS[i % COLORS.length];
    const node = el("div", "swarm-agent", r.layer);
    node.style.color = color;
    node.innerHTML = CURSOR_SVG;
    const tag = el("span", "swarm-tag", node);
    tag.textContent = NAMES[i % NAMES.length];
    tag.style.background = color;

    const a = {
      i,
      color,
      node,
      x: start.x + rand(-60, 60),
      y: start.y + rand(-60, 60),
      vx: rand(-400, 400),
      vy: rand(-400, 400),
      tx: start.x,
      ty: start.y,
      pinned: false,
      arrive: null,
      busy: false,
      idleSeed: rand(0, Math.PI * 2),
    };

    a.goto = (x, y) =>
      r.guard((res) => {
        a.pinned = false;
        a.tx = x;
        a.ty = y;
        a.arrive = res;
      });

    a.place = (x, y) => {
      a.pinned = true;
      a.x = a.tx = x;
      a.y = a.ty = y;
      a.vx = a.vy = 0;
    };

    a.setTool = (tool) => node.setAttribute("data-tool", tool || "");
    return a;
  }

  function physics(r, now) {
    const dt = Math.min(0.04, (now - (r.last || now)) / 1000);
    r.last = now;
    const s = getSpeed();
    // 2x faster cursor travel speed (2200px/s)
    const maxSpeed = 2200 * s;
    const agents = r.agents;

    for (const a of agents) {
      if (!a.pinned) {
        if (!a.busy && !a.arrive) {
          const t = now / 1000 + a.idleSeed;
          a.tx = r.focus.x + Math.cos(t * 1.5 + a.i) * (80 + (a.i % 4) * 15);
          a.ty = r.focus.y + Math.sin(t * 1.8 + a.i * 2) * (50 + (a.i % 4) * 12);
        }
        const dx = a.tx - a.x;
        const dy = a.ty - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const want = Math.min(maxSpeed, dist * 12 * s);
        let dvx = (dx / dist) * want;
        let dvy = (dy / dist) * want;

        for (const b of agents) {
          if (b === a) continue;
          const ox = a.x - b.x;
          const oy = a.y - b.y;
          const d = Math.hypot(ox, oy);
          if (d > 0 && d < 36) {
            const push = ((36 - d) / 36) * 320;
            dvx += (ox / d) * push;
            dvy += (oy / d) * push;
          }
        }

        const k = 1 - Math.exp(-dt * 14);
        a.vx += (dvx - a.vx) * k;
        a.vy += (dvy - a.vy) * k;
        a.x += a.vx * dt;
        a.y += a.vy * dt;

        if (a.arrive && dist < 16) {
          const done = a.arrive;
          a.arrive = null;
          a.x = a.tx;
          a.y = a.ty;
          done();
        }
      }
      a.node.style.transform = `translate3d(${a.x}px, ${a.y}px, 0)`;
    }
    r.raf = requestAnimationFrame((t) => physics(r, t));
  }

  /* ------------------------------------------------------------------ */
  /* Rebuild Actions (2x Faster Durations)                              */
  /* ------------------------------------------------------------------ */

  async function dragBox(r, a, t) {
    const ghost = el("div", "swarm-ghost", r.layer);
    ghost.style.cssText = `left:${t.x}px;top:${t.y}px;width:0;height:0;--c:${a.color}`;
    const badge = el("span", "swarm-badge", ghost);
    badge.style.background = a.color;
    t.ghost = ghost;

    a.setTool("cross");
    await a.goto(t.x, t.y);
    // 2x faster duration for box drag
    const dur = Math.min(190, 90 + (t.w + t.h) * 0.06);
    await r.tween(dur, (p) => {
      const w = t.w * p;
      const h = t.h * p;
      ghost.style.width = w + "px";
      ghost.style.height = h + "px";
      badge.textContent = `${Math.round(w)} × ${Math.round(h)}`;
      a.place(t.x + w, t.y + h);
    });
    a.setTool("");
  }

  async function traceBorder(r, a, t) {
    const radius = Math.min(parseFloat(t.cs.borderTopLeftRadius) || 0, t.w / 2, t.h / 2);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "swarm-pen");
    svg.setAttribute("width", t.w);
    svg.setAttribute("height", t.h);
    svg.style.cssText = `left:${t.x}px;top:${t.y}px`;
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", 0.75);
    rect.setAttribute("y", 0.75);
    rect.setAttribute("width", Math.max(0, t.w - 1.5));
    rect.setAttribute("height", Math.max(0, t.h - 1.5));
    rect.setAttribute("rx", radius);
    rect.setAttribute("stroke", a.color);
    svg.appendChild(rect);
    r.layer.appendChild(svg);
    t.pen = svg;

    const len = rect.getTotalLength ? rect.getTotalLength() : 2 * (t.w + t.h);
    rect.style.strokeDasharray = len;
    rect.style.strokeDashoffset = len;

    a.setTool("pen");
    const corners = [
      [t.x, t.y],
      [t.x + t.w, t.y],
      [t.x + t.w, t.y + t.h],
      [t.x, t.y + t.h],
      [t.x, t.y],
    ];
    const per = 2 * (t.w + t.h);
    // 2x faster duration for border pen
    const dur = Math.min(210, 100 + per * 0.04);
    await r.tween(dur, (p) => {
      rect.style.strokeDashoffset = len * (1 - p);
      let d = p * per;
      for (let k = 0; k < 4; k++) {
        const [x1, y1] = corners[k];
        const [x2, y2] = corners[k + 1];
        const seg = Math.hypot(x2 - x1, y2 - y1);
        if (d <= seg || k === 3) {
          const f = seg ? Math.min(1, d / seg) : 0;
          a.place(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f);
          break;
        }
        d -= seg;
      }
    });
    a.setTool("");
  }

  async function fillBox(r, t) {
    if (!t.ghost) return;
    const g = t.ghost;
    g.classList.add("is-filled");
    g.style.borderRadius = t.cs.borderRadius;
    g.style.backgroundColor = t.cs.backgroundColor;
    if (t.cs.backgroundImage !== "none") g.style.backgroundImage = t.cs.backgroundImage;
    if (t.cs.boxShadow !== "none") g.style.boxShadow = t.cs.boxShadow;
    await r.wait(50);
  }

  async function typeText(r, a, t) {
    const cs = t.cs;
    const ghost = el("div", "swarm-text", r.layer);
    ghost.style.cssText =
      `left:${t.content.x}px;top:${t.content.y}px;width:${t.content.w + 2}px;` +
      `font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};` +
      `font-style:${cs.fontStyle};color:${cs.color};letter-spacing:${cs.letterSpacing};` +
      `text-transform:${cs.textTransform};text-align:${cs.textAlign};line-height:${cs.lineHeight};` +
      `--c:${a.color}`;
    const span = el("span", "", ghost);
    const caret = el("i", "swarm-caret", ghost);
    t.typed = ghost;

    const cr = () => caret.getBoundingClientRect();
    let c = cr();
    a.setTool("text");
    await a.goto(c.left + window.scrollX, c.bottom + window.scrollY);

    const chars = Array.from(t.text);
    // 2x faster duration for text typewriter
    const total = Math.min(250, 65 + chars.length * 4.5);
    let shown = 0;
    await r.tween(total, (_p, raw) => {
      const n = Math.round(raw * chars.length);
      if (n !== shown) {
        shown = n;
        span.textContent = chars.slice(0, n).join("");
        c = cr();
        a.place(c.left + window.scrollX + 2, c.bottom + window.scrollY);
      }
    });
    a.setTool("");
  }

  async function dropImage(r, a, t) {
    await dragBox(r, a, t);
    t.ghost.classList.add("is-image");
    await r.wait(60);
  }

  function revealTask(t) {
    t.el.classList.remove("swarm-pending");
    t.el.classList.add("swarm-revealing");
    const leftovers = [t.ghost, t.pen, t.typed].filter(Boolean);
    leftovers.forEach((n) => n.classList.add("is-leaving"));
    setTimeout(() => leftovers.forEach((n) => n.remove()), 300);
  }

  async function performTask(r, a, t) {
    const liveRect = t.el.getBoundingClientRect();
    t.x = liveRect.left + window.scrollX;
    t.y = liveRect.top + window.scrollY;
    t.w = liveRect.width;
    t.h = liveRect.height;
    t.content.x = t.x + (t.content.padLeft || 0);
    t.content.y = t.y + (t.content.padTop || 0);
    t.content.w = Math.max(10, t.w - (t.content.padLeft || 0) - (t.content.padRight || 0));

    r.focus = { x: t.x + t.w / 2, y: t.y + t.h / 2 };

    if (t.isImg) {
      await dropImage(r, a, t);
    } else {
      if (t.box) {
        await dragBox(r, a, t);
        if (t.border && (t.w > 120 || t.h > 60)) {
          await traceBorder(r, a, t);
        }
        await fillBox(r, t);
      }
      if (t.text) await typeText(r, a, t);
    }
    revealTask(t);
    await r.wait(30);
  }

  /* ------------------------------------------------------------------ */
  /* Section Build Execution                                            */
  /* ------------------------------------------------------------------ */

  function claimNextTask(tasks) {
    return tasks.find(
      (t) => t.state === "pending" && (!t.parent || t.parent.state === "done")
    );
  }

  async function buildSection(r, sec) {
    if (!sec || sec.state !== "pending") return;
    sec.state = "building";
    r.buildingSection = sec;

    const name = friendlyName(sec.el);
    setToolbarStatus(r, `Building ${name}...`);

    const tasks = sec.tasks;
    if (tasks && tasks.length) {
      const firstTask = tasks[0];
      r.focus = { x: firstTask.x + firstTask.w / 2, y: firstTask.y + firstTask.h / 2 };

      const workerPromises = r.agents.map(async (a) => {
        await r.wait(a.i * 35);
        while (tasks.some((t) => t.state !== "done")) {
          if (r.cancelled) return;
          const t = claimNextTask(tasks);
          if (!t) {
            a.busy = false;
            a.arrive = null;
            await r.nextSignal();
            continue;
          }
          t.state = "active";
          a.busy = true;
          try {
            await performTask(r, a, t);
          } finally {
            t.state = "done";
            a.busy = false;
            r.signal();
          }
        }
      });

      await Promise.all(workerPromises);
    }

    sec.state = "done";
    sec.el.classList.remove("swarm-section-pending");
    r.buildingSection = null;
  }

  /* ------------------------------------------------------------------ */
  /* Guided Scroll-Follow Tour (Build -> Follow Scroll -> Return Top)  */
  /* ------------------------------------------------------------------ */

  async function runTour(r) {
    try {
      for (let i = 0; i < r.sections.length; i++) {
        if (r.cancelled) return;
        const sec = r.sections[i];

        // Smoothly scroll section into view so viewport follows the rebuild
        if (i === 0) {
          window.scrollTo({ top: 0, behavior: "smooth" });
          await r.wait(200);
        } else {
          sec.el.scrollIntoView({ behavior: "smooth", block: "start" });
          // Scroll arrival wait
          await r.wait(400);
        }

        if (r.cancelled) return;

        // Build this section
        await buildSection(r, sec);

        // Brief pause after finishing section
        await r.wait(200);
      }

      if (r.cancelled) return;

      // Entire site finished! Smoothly scroll back all the way to the top!
      window.scrollTo({ top: 0, behavior: "smooth" });
      await r.wait(500);

      finishFullRebuild(r);
    } catch (err) {
      if (err !== CANCEL) console.error("[Swarm Tour]", err);
    }
  }

  function finishFullRebuild(r) {
    if (!r.toolbar) return;
    r.toolbar.classList.add("is-done");
    setToolbarStatus(r, "Rebuilt by the swarm");
    const skipBtn = r.toolbar.querySelector('[data-act="skip"]');
    const speedBtn = r.toolbar.querySelector('[data-act="speed"]');
    const replayBtn = r.toolbar.querySelector('[data-act="replay"]');
    const liveBtn = r.toolbar.querySelector('[data-act="live"]');
    if (skipBtn) skipBtn.hidden = true;
    if (speedBtn) speedBtn.hidden = true;
    if (replayBtn) replayBtn.hidden = false;
    if (liveBtn) liveBtn.hidden = false;

    if (r.canvas) r.canvas.classList.add("is-leaving");
  }

  /* ------------------------------------------------------------------ */
  /* Toolbar                                                            */
  /* ------------------------------------------------------------------ */

  function setToolbarStatus(r, text) {
    if (!r.toolbar) return;
    const st = r.toolbar.querySelector(".swarm-status");
    if (st) st.textContent = text;
  }

  function buildToolbar(r) {
    const bar = el("div", "swarm-toolbar", document.body);
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Swarm rebuild controls");
    bar.innerHTML =
      '<span class="swarm-dot" aria-hidden="true"></span>' +
      '<span class="swarm-status">Building page...</span>' +
      '<button type="button" data-act="speed" title="Change speed"></button>' +
      '<button type="button" data-act="skip" title="Skip animation (Esc)">Skip</button>' +
      '<button type="button" data-act="replay" hidden>Replay</button>' +
      '<button type="button" data-act="live" hidden>Go live</button>';

    const speedBtn = bar.querySelector('[data-act="speed"]');
    const paintSpeed = () => (speedBtn.textContent = getSpeed() + "×");
    paintSpeed();

    bar.addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act === "speed") {
        speedIndex = (speedIndex + 1) % SPEEDS.length;
        localStorage.setItem("swarmSpeed", String(getSpeed()));
        paintSpeed();
      } else if (act === "skip" || act === "live") {
        Swarm.skip();
      } else if (act === "replay") {
        Swarm.replay();
      }
    });

    r.toolbar = bar;
    requestAnimationFrame(() => bar.classList.add("is-on"));
  }

  /* ------------------------------------------------------------------ */
  /* Teardown (Instant Skip / Completion)                                */
  /* ------------------------------------------------------------------ */

  function teardown(r, instant) {
    r.cancel();
    cancelAnimationFrame(r.raf);

    r.sections.forEach((sec) => {
      sec.el.classList.remove("swarm-section-pending");
      sec.tasks.forEach((t) => {
        t.el.classList.remove("swarm-pending");
        if (!instant) t.el.classList.add("swarm-revealing");
      });
    });

    document.querySelectorAll("[aria-hidden='true']").forEach((d) => {
      d.classList.remove("swarm-pending");
    });

    r.root.classList.remove("swarm-root");
    document.body.classList.remove("swarm-active");

    const nodes = [r.layer, r.canvas, r.toolbar].filter(Boolean);
    nodes.forEach((n) => n.classList.add("is-leaving"));
    setTimeout(() => {
      nodes.forEach((n) => n.remove());
      r.sections.forEach((sec) => {
        sec.tasks.forEach((t) => t.el.classList.remove("swarm-revealing"));
      });
    }, instant ? 0 : 300);

    if (activeRun === r) activeRun = null;
  }

  /* ------------------------------------------------------------------ */
  /* Swarm Initialization                                               */
  /* ------------------------------------------------------------------ */

  function init(opts = {}) {
    if (activeRun) teardown(activeRun, true);

    const root = typeof opts.root === "string" ? document.querySelector(opts.root) : opts.root || document.querySelector("main") || document.body;
    if (!root) return;

    const small = window.innerWidth <= 640;
    const count = Math.max(4, Math.min(12, opts.agents || (small ? 6 : 10)));
    const r = createRun(root);
    activeRun = r;

    document.body.classList.add("swarm-active");
    root.classList.add("swarm-root");

    const sectionElements = Array.from(root.querySelectorAll("section"));
    if (!sectionElements.length) {
      teardown(r, true);
      return;
    }

    r.canvas = el("div", "swarm-canvas", document.body);
    r.layer = el("div", "swarm-layer", document.body);

    buildToolbar(r);

    const start = { x: mouse.x, y: mouse.y };
    for (let i = 0; i < count; i++) {
      r.agents.push(createAgent(r, i, start));
    }
    r.raf = requestAnimationFrame((t) => physics(r, t));

    r.sections = sectionElements.map((sec) => {
      const tasks = snapshotSection(sec);
      tasks.forEach((t) => t.el.classList.add("swarm-pending"));
      sec.classList.add("swarm-section-pending");
      return {
        el: sec,
        id: sec.id,
        state: "pending",
        tasks,
      };
    });

    runTour(r);

    return r;
  }

  /* ------------------------------------------------------------------ */
  /* Public Interface                                                   */
  /* ------------------------------------------------------------------ */

  const Swarm = {
    init,
    play: (opts) => init(opts),
    skip() {
      if (activeRun) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        teardown(activeRun, false);
      }
    },
    async replay() {
      if (activeRun) teardown(activeRun, true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      await new Promise((res) => setTimeout(res, 250));
      return init({ root: "main" });
    },
    triggerSectionById(id) {
      if (!activeRun) return;
      const sec = activeRun.sections.find((s) => s.id === id);
      if (sec && sec.state === "pending") {
        sec.el.scrollIntoView({ behavior: "smooth", block: "start" });
        buildSection(activeRun, sec);
      }
    },
    isRunning: () => !!activeRun,
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeRun) {
      e.preventDefault();
      Swarm.skip();
    }
    if (e.altKey && e.shiftKey && (e.key === "S" || e.key === "s" || e.code === "KeyS")) {
      e.preventDefault();
      Swarm.replay();
    }
  });

  window.Swarm = Swarm;
})();
