(function () {
  const WORD = "FRAGMENTS";
  const GLYPHS = ["o", "o", "o", "c", "e", "F", "R", "A", "G", "M", "N", "T", "S", "Z", "a", "B", "b", "G", "P", "E", "h"];
  const START_SIZE = 10;
  const END_SIZE = 1.5;
  const TRACKING_EM = 0.02;

  function hashGlyph(x, y) {
    return GLYPHS[Math.abs((x * 73856093) ^ (y * 19349663)) % GLYPHS.length];
  }

  function rand(n) {
    n = Math.imul(n ^ (n >>> 16), 2246822519);
    n = Math.imul(n ^ (n >>> 13), 3266489917);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function clamp01(value) {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  function ease(t) {
    const clamped = clamp01(t / 0.88);
    return clamped * clamped * (3 - 2 * clamped);
  }

  function scatterInView(width, height, seed) {
    const marginX = width * 0.55;
    const marginY = height * 0.55;
    return {
      sx: -marginX + rand(seed) * (width + marginX * 2),
      sy: -marginY + rand(seed + 19) * (height + marginY * 2),
    };
  }

  function arriveFromOutside(lockX, lockY, width, height, seed) {
    const angle = rand(seed + 7) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const pad = START_SIZE + 8;
    const minX = -pad;
    const maxX = width + pad;
    const minY = -pad;
    const maxY = height + pad;

    let tHit = Infinity;
    if (dx > 1e-6) tHit = Math.min(tHit, (maxX - lockX) / dx);
    else if (dx < -1e-6) tHit = Math.min(tHit, (minX - lockX) / dx);
    if (dy > 1e-6) tHit = Math.min(tHit, (maxY - lockY) / dy);
    else if (dy < -1e-6) tHit = Math.min(tHit, (minY - lockY) / dy);
    if (!Number.isFinite(tHit) || tHit <= 0) {
      return scatterInView(width, height, seed);
    }

    const edgeX = lockX + dx * tHit;
    const edgeY = lockY + dy * tHit;
    const vx = edgeX - lockX;
    const vy = edgeY - lockY;
    const edgeDist = Math.hypot(vx, vy) || 1;
    const span = Math.hypot(width, height);
    const dist = Math.max(edgeDist + span * 0.35, span * (0.55 + rand(seed + 41) * 0.9));
    return {
      sx: lockX + (vx / edgeDist) * dist,
      sy: lockY + (vy / edgeDist) * dist,
    };
  }

  function fillTrackedText(ctx, text, cx, letterSpacing) {
    const widths = [...text].map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((sum, width) => sum + width, 0) + letterSpacing * (text.length - 1);
    let x = cx - total / 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < text.length; i++) {
      ctx.fillText(text[i], x, 0);
      x += widths[i] + letterSpacing;
    }
  }

  function drawWord(ctx, word, width, height) {
    ctx.save();
    ctx.translate(width / 2, word.ascent + (height - word.height) / 2);
    ctx.scale(word.sx, 1);
    fillTrackedText(ctx, WORD, 0, word.letterSpacing);
    ctx.restore();
  }

  function wordExtents(ctx) {
    let ascent = 0;
    let descent = 0;
    for (const ch of WORD) {
      const metrics = ctx.measureText(ch);
      ascent = Math.max(ascent, metrics.actualBoundingBoxAscent || 0);
      descent = Math.max(descent, metrics.actualBoundingBoxDescent || 0);
    }
    return { ascent, descent, height: Math.max(ascent + descent, 1) };
  }

  function fitWord(ctx, family, weight, width, height) {
    const trial = 200;
    ctx.font = `${weight} ${trial}px ${family}`;
    const trialHeight = wordExtents(ctx).height;
    const fontSize = trial * ((height * 0.5 * 0.995) / trialHeight);
    ctx.font = `${weight} ${fontSize}px ${family}`;
    const letterSpacing = fontSize * TRACKING_EM;
    const naturalWidth =
      [...WORD].reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + letterSpacing * (WORD.length - 1);
    const extents = wordExtents(ctx);
    const sx = Math.min(1, (width * 0.97) / naturalWidth);
    return {
      fontSize,
      letterSpacing,
      font: `${weight} ${fontSize}px ${family}`,
      sx,
      ascent: extents.ascent,
      height: extents.height,
    };
  }

  const pin = document.querySelector(".fragments-pin");
  const canvas = pin && pin.querySelector(".fragments-canvas");
  const measure = pin && pin.querySelector(".fragments-measure");
  if (!pin || !canvas || !measure) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let points = [];
  let word = null;
  let cancelled = false;
  let resizeFrame = 0;
  let scrollFrame = 0;

  function scrollProgress() {
    const rect = pin.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    const progress = travel <= 0 ? 1 : Math.min(1, Math.max(0, -rect.top / travel));
    pin.style.setProperty("--title-progress", String(progress));
    return progress;
  }

  function progress() {
    if (reduce.matches) return 1;
    return scrollProgress();
  }

  function ink() {
    return getComputedStyle(document.body).color || "#000000";
  }

  function sample() {
    const stage = canvas.parentElement;
    if (!stage) return;

    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width < 2 || height < 2) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const style = getComputedStyle(measure);
    word = fitWord(ctx, style.fontFamily, style.fontWeight, width, height);

    const scale = 1;
    const off = document.createElement("canvas");
    off.width = width * scale;
    off.height = height * scale;
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    offCtx.scale(scale, scale);
    offCtx.font = word.font;
    offCtx.fillStyle = "#000";
    drawWord(offCtx, word, width, height);

    const sampleW = off.width;
    const sampleH = off.height;
    const { data } = offCtx.getImageData(0, 0, sampleW, sampleH);
    const next = [];

    for (let y = 0; y < sampleH; y += 1) {
      for (let x = 0; x < sampleW; x += 1) {
        if (data[(y * sampleW + x) * 4 + 3] < 20) continue;
        const cssX = x / scale;
        const cssY = y / scale;
        const seed = y * sampleW + x;
        const enter = (rand(seed + 31) - 0.14) * 0.86;
        const start =
          enter <= 0
            ? scatterInView(width, height, seed)
            : arriveFromOutside(cssX, cssY, width, height, seed);
        next.push({
          x: cssX,
          y: cssY,
          sx: start.sx,
          sy: start.sy,
          ch: hashGlyph(x, y),
        });
      }
    }

    points = next;
    canvas.dataset.letters = String(next.length);
    scrollProgress();
    draw();
  }

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    const t = ease(progress());
    const glyph = START_SIZE + (END_SIZE - START_SIZE) * t;
    const style = getComputedStyle(measure);
    const color = ink();
    const solid = clamp01((t - 0.78) / 0.2);

    if (solid < 0.98) {
      ctx.fillStyle = color;
      ctx.font = `400 ${glyph.toFixed(2)}px ${style.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 1 - solid;
      const pad = START_SIZE + 12;
      for (const point of points) {
        const px = point.sx + (point.x - point.sx) * t;
        const py = point.sy + (point.y - point.sy) * t;
        if (px < -pad || py < -pad || px > width + pad || py > height + pad) continue;
        ctx.fillText(point.ch, px, py);
      }
    }

    if (solid > 0 && word) {
      ctx.globalAlpha = solid;
      ctx.fillStyle = color;
      ctx.font = word.font;
      drawWord(ctx, word, width, height);
    }

    ctx.globalAlpha = 1;
  }

  function onScroll() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      scrollProgress();
      draw();
    });
  }

  function onResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      scrollProgress();
      sample();
    });
  }

  const observer = new ResizeObserver(onResize);
  observer.observe(canvas.parentElement);
  reduce.addEventListener("change", () => {
    scrollProgress();
    draw();
  });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  scrollProgress();
  sample();

  function resampleWhenReady() {
    if (!cancelled) sample();
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(resampleWhenReady);
    Promise.all([
      document.fonts.load('400 16px "Bodoni Moda"'),
      document.fonts.load('600 120px "Bodoni Moda"'),
    ]).then(resampleWhenReady);
  }

  window.addEventListener("pagehide", () => {
    cancelled = true;
  });
})();
