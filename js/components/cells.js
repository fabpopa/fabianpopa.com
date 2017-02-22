// creates cells animation component
// requires width and height in pixels
const Cells = function(width, height) {
  if (typeof width !== 'number' || typeof height !== 'number')
    throw new Error('Cells requires number params');

  // convenience math functions
  const rnd = () => Math.random();
  const rou = (x) => Math.round(x);
  const flr = (x) => Math.floor(x);
  const cei = (x) => Math.ceil(x);
  const sin = (x) => Math.sin(x);
  const abs = (x) => Math.abs(x);
  const min = (x, y) => Math.min(x, y);
  const pow = (x, y) => Math.pow(x, y);
  const PI = Math.PI;

  // animation options
  const opt = {
    sizeMin: flr(height / 8),   // pixels, even number
    sizeMax: flr(height / 3),   // pixels, even number
    angMin: -120,               // degrees
    angMax: -60,                // degrees
    flipTMin: 2,                // seconds
    flipTMax: 5,                // seconds
    jigMin: 3,                  // pixels
    jigMax: 3,                  // pixels
    jigTMin: 2,                 // seconds
    jigTMax: 2,                 // seconds
    buffer: flr(height / 14),   // pixels
    velocity: 40,               // pixels per second, can't be 0
    padMax: flr(height / 3.3),  // pixels
    padTime: 14                 // seconds, tweak based on velocity
  };

  // HTMLElement to return
  const el = document.createElement('div');
  el.setAttribute('component', 'cells');
  el.style['width'] = `${width}px`;
  el.style['height'] = `${height}px`;

  // stylesheet element to append to document.head
  const style = (() => {
    const c = '[component=cells]';
    const css = `
      ${c} { position: relative; width: 100%; height: 100%; overflow: hidden; }
      ${c}.paused *, ${c} .paused * { animation-play-state: paused !important; }
      ${c} .cell { position: absolute; width: 4em; height: 4em;
                   transform: translateX(-100%); }
      ${c} .cell * { width: 100%; height: 100%; }
      ${c} .jiggleY > * { position: absolute; border-radius: 50%; }
      ${c} .outside { width: 4em; height: 4em; background: #f27474; }
      ${c} .inside { width: 2em; height: 2em; background: #d23a3a; }
      @keyframes move { from { transform: translateX(-100%); opacity: 0; }
                        20%, 80% { opacity: 1 }
                        to { transform: translateX(${width}px); opacity: 0; } }
      @keyframes jiggleX { from { transform: translateX(-1em); }
                           to { transform: translateX(1em); } }
      @keyframes jiggleY { from { transform: translateY(-1em); }
                           to { transform: translateY(1em); } }
      @keyframes outside { 0%, 100% { transform: scaleY(.2); }
                           50% { transform: scaleY(1); } }
      @keyframes inside
        { 0% { transform: translate(1em, .68em) scale(.96, 0); }
          50% { transform: translate(1em, 1em) scale(1, 1); }
          100% { transform: translate(1em, 1.32em) scale(.9, 0); } }
    `;

    const el = document.createElement('style');
    el.innerHTML = css;
    return el;
  })();

  const makeCellEl = (cells) => {
    const cell = document.createElement('div');
    const angle = document.createElement('div');
    const jiggleX = document.createElement('div');
    const jiggleY = document.createElement('div');
    const outside = document.createElement('div');
    const inside = document.createElement('div');
    cell.className = 'cell';
    angle.className = 'angle';
    jiggleX.className = 'jiggleX';
    jiggleY.className = 'jiggleY';
    outside.className = 'outside';
    inside.className = 'inside';
    jiggleY.appendChild(outside);
    jiggleY.appendChild(inside);
    jiggleX.appendChild(jiggleY);
    angle.appendChild(jiggleX);
    cell.appendChild(angle);
    cell['angle'] = angle;
    cell['jiggleX'] = jiggleX;
    cell['jiggleY'] = jiggleY;
    cell['outside'] = outside;
    cell['inside'] = inside;
    cell.classList.add('paused');
    cells.appendChild(cell);
    return cell;
  };

  // line at x = 0 to insert cells where they don't overlap
  const entryLine = (() => {
    const pixels = new Array(height);
    let i;
    return {
      reset: () => {
        for (i = 0; i < pixels.length; i++) pixels[i] = true;
      },
      mark: (from, to) => {
        if (from < 0) from = 0;
        if (to > pixels.length - 1) to = pixels.length - 1;
        // console.log(from, to);
        for (i = from; i <= to; i++) pixels[i] = false;
      },
      window: () => {
        // return largest continuous block of empty pixels
        let space = { start: 0, end: 0, size: 0 };
        for (i = 0, j = 1; j <= pixels.length; j++)
          if (j == pixels.length || pixels[j - 1] != pixels[j])
            if (pixels[j - 1]) {
              if (j - i > space.size) {
                space.start = i;
                space.end = j - 1;
                space.size = j - i;
              }
            } else i = j;
        // console.log('window: ', space);
        return space;
      }
    };
  })();

  // sin wave of side padding to create a nice organic shape for cell stream
  const sinPad = ((size, cycle) => {
    let lastTime, progress, value;
    return (time) => {
      if (!lastTime) { lastTime = time; progress = 0; }
      progress = (progress + time - lastTime) % cycle;
      value = rou(size * abs(sin(progress / cycle * 2 * PI)));
      lastTime = time;
      return value;
    };
  })(opt.padMax, opt.padTime * 1000);

  // circular buffer for last launched cell indexes
  const lastLaunched = (() => {
    const maxCount = cei(height / (opt.sizeMin + 2 * opt.jigMin + opt.buffer));
    const buffer = new Array(maxCount);
    let i = 0;
    buffer.add = (item) => { buffer[i] = item; i = (i + 1) % buffer.length; };
    return buffer;
  })();

  // avoid work on a frame when possible
  let sleepTil = 0;

  // all the element styling to facilitate animation
  const launch = (cell, time, lastNow) => {
    cell.el.style['font-size'] = `${cell.size / 4}px`;
    cell.el.outside.style['font-size'] = `${cell.size / 4}px`;
    cell.el.inside.style['font-size'] = `${cell.size / 4}px`;
    cell.el.angle.style['transform'] = `rotate(${cell.angle}deg)`;
    cell.el.style['padding'] = `${cell.jiggle}px`;
    cell.el.jiggleX.style['font-size'] = `${cell.jiggle}px`;
    cell.el.style['top'] = `${cell.y - flr(cell.size / 2) - cell.jiggle}px`;
    cell.launchedAt = null;

    // at least one frame between animation end and element reuse
    window.requestAnimationFrame((now) => {
      cell.el.classList.remove('paused');
      cell.el.addEventListener('animationend', function h() {
        cell.el.removeEventListener('animationend', h);
        cell.el.classList.add('paused');
        cell.el.style['animation'] = '';
        cell.el.outside.style['animation'] = '';
        cell.el.inside.style['animation'] = '';
        cell.el.jiggleX.style['animation'] = '';
        cell.el.jiggleY.style['animation'] = '';
        cell.y = null;
      });
      cell.launchedAt = time + now - lastNow;
      sleepTil = cell.launchedAt;
      sleepTil += (cell.size / 2 + cell.jiggle) / opt.velocity * 1000;
      cell.el.outside.style['animation'] =
        `${cell.flipTime}s linear infinite outside`;
      cell.el.inside.style['animation'] =
        `${cell.flipTime}s linear infinite inside`;
      cell.el.jiggleX.style['animation'] =
        `${cell.jiggleTime}s ease-in-out infinite alternate jiggleX`;
      cell.el.jiggleY.style['animation'] =
        `${cell.jiggleTime}s ease-in-out infinite alternate jiggleY`;
      cell.el.style['animation'] = `${cell.travelTime}s linear move`;
    });
  };

  // cell elements created in advance, attached to DOM and never removed
  const cells = (() => {
    // allocate objects for theoretical max number of cells
    const poolCount = flr(width * height / pow(opt.sizeMin, 2));
    const pool = new Array(poolCount);

    // populate cell pool
    for (let i = 0; i < pool.length; i++) pool[i] = {
      size: null,        // pixels
      angle: null,       // degrees
      flipTime: null,    // seconds
      jiggle: null,      // pixels
      jiggleTime: null,  // seconds
      jigglePhX: null,   // time phase shift within 0-jiggleTime seconds
      jigglePhY: null,   // time phase shift within 0-jiggleTime seconds
      y: null,           // pixels, vertical center of cell
      launchedAt: null,  // ms returned from performance.now()
      travelDist: null,  // pixels to travel from -100% to width across canvas
      travelTime: null,  // seconds to travel from -100% to width across canvas
      el: makeCellEl(el) // DOM element
    };

    const active = (i) => typeof i == 'number' && pool[i].y !== null;

    // cache, hot object
    const c = {
      pad: null, space: null, cell: null, i: null, li: null,
      occupied: null, half: null, traveled: null
    };

    const addIfSpace = (time, now) => {
      c.pad = sinPad(time);         // advance sin pad
      if (time < sleepTil) return;  // sleep for half of last cell
      if (rnd() % .3 > .02) return; // increase spread by random rejection

      entryLine.reset();
      for (c.li = 0; c.li < lastLaunched.length; c.li++) {
        c.i = lastLaunched[c.li];
        c.cell = pool[c.i];
        if (!active(c.i) || !c.cell.launchedAt) continue;
        c.occupied = c.cell.size + c.cell.jiggle * 2 + opt.buffer * 2;
        c.half = flr(c.occupied / 2);
        c.traveled = c.cell.travelDist;
        c.traveled *= (time - c.cell.launchedAt) / (c.cell.travelTime * 1000);
        if (c.traveled > c.occupied - opt.buffer) continue; // cell past entry
        entryLine.mark(c.cell.y - c.half, c.cell.y + c.half);
      }
      entryLine.mark(0, c.pad);
      entryLine.mark(height - c.pad - 1, height - 1);

      c.space = entryLine.window();
      if (c.space.size < opt.sizeMin + opt.jigMin * 2) return;

      for (c.i = 0; c.i < pool.length; c.i++) if (!active(c.i)) break;
      if (c.i === pool.length) return;
      c.cell = pool[c.i];

      c.cell.angle = opt.angMin + rou(rnd() * abs(opt.angMax - opt.angMin));
      c.cell.flipTime = opt.flipTMin + rnd() * (opt.flipTMax - opt.flipTMin);
      c.cell.jiggle = opt.jigMin + rou(rnd() * (opt.jigMax - opt.jigMin));
      c.cell.jiggleTime = opt.jigTMin + rnd() * (opt.jigTMax - opt.jigTMin);
      c.cell.jigglePhX = rnd() * c.cell.jiggleTime;
      c.cell.jigglePhY = rnd() * c.cell.jiggleTime;
      c.cell.y = rou(c.space.start + c.space.size / 2);
      c.cell.size = flr(rnd() * (min(opt.sizeMax, c.space.size) - opt.sizeMin));
      c.cell.size += opt.sizeMin;
      c.cell.travelDist = width + c.cell.size + 2 * c.cell.jiggle;
      c.cell.travelTime = c.cell.travelDist / opt.velocity;

      launch(c.cell, time, now);
      lastLaunched.add(c.i);
    };

    return addIfSpace;
  })();

  // attach stylesheet
  document.head.appendChild(style);

  let raf, lastNow, time = 0;

  const anim = (now) => {
    time += now - lastNow;
    lastNow = now;
    cells(time, now);
    raf = window.requestAnimationFrame(anim);
  };

  const go = (cb) => {
    if (!lastNow) window.requestAnimationFrame((now) => {
      lastNow = now;
      raf = window.requestAnimationFrame((now) => { if (cb) cb(); anim(now); });
    });
  };

  el.pause = () => {
    window.cancelAnimationFrame(raf);
    lastNow = null;
    el.classList.add('paused');
  };

  el.unpause = () => {
    if (lastNow) return;
    go(() => { el.classList.remove('paused'); });
  };

  // some browsers pause animation on visibility change silently, be explicit
  let v = () => { if (document.hidden) { el.pause(); } else { el.unpause(); } };
  document.addEventListener('visibilitychange', v);

  el.cleanup = () => {
    el.pause();
    document.head.removeChild(style);
    document.removeEventListener('visibilitychange', v);
  };

  go();
  return el;
};
