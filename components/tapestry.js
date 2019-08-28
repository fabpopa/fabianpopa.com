const abs = x => Math.abs(x);
const floor = x => Math.floor(x);
const ceil = x => Math.ceil(x);
const sqrt = x => Math.sqrt(x);
const pow = (x, p) => Math.pow(x, 2);
const min = (...n) => Math.min(...n);
const max = (...n) => Math.max(...n);
const rnd = () => Math.random();

const symbols = [{
  href: 'sera.bio',
  svg: `<svg viewBox="0 0 220 390" width="70%">
    <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
      <g transform="translate(-120.000000, -21.000000)" stroke="red" stroke-width="24">
        <path d="M229.831461,42.6997687 C227.608873,46.1404387 225.272621,49.8111596 222.840306,53.6947551 C210.124079,73.9983305 197.405539,95.8996571 185.546798,118.549852 C170.870613,146.581366 158.569193,173.774199 149.424249,199.321513 C138.079071,231.015403 132,259.08369 132,282.398876 C132,325.751473 145.751267,356.691823 169.48237,376.750256 C187.526579,392.001909 210.915956,400 229.831461,400 C248.746966,400 272.136342,392.001909 290.180551,376.750256 C313.911655,356.691823 327.662921,325.751473 327.662921,282.398876 C327.662921,259.08369 321.58385,231.015403 310.238672,199.321513 C301.093729,173.774199 288.792309,146.581366 274.116123,118.549852 C262.257382,95.8996571 249.538842,73.9983305 236.822615,53.6947551 C234.390301,49.8111596 232.054049,46.1404387 229.831461,42.6997687 Z" />
      </g>
    </g>
  </svg>
  `
}];

const css = `
  [component="tapestry"] {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: -1;
  }
  [component="tapestry"] .point {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  [component="tapestry"] .point .symbol {
    opacity: 0.001; /* Quirk: Not quite 0 to keep layer primed for animation. */
    transition-property: opacity;
    transition-duration: 2s;
    transition-timing-function: ease-in-out;
    will-change: opacity;
  }
`;

class Tapestry {
  constructor(el) {
    this._size = 16; // Point size.
    this._pad = 14; // Padding around points.
    this._ospad = 30; // Padding around occupied space.
    this._root = document.documentElement;
    this._width = null;
    this._height = null;
    this._canvas = el;
    this._els = null;
    this._standbyIid = null; // Interval id if standby animation is running.

    const style = document.createElement('style');
    style.innerHTML = css;
    document.head.appendChild(style);

    // Reinitialize on window resize.
    let debounceTid;
    window.addEventListener('resize', () => {
      if (this._els) {
        this._els.forEach(el => this._canvas.removeChild(el));
        this._els = null;
      }

      if (debounceTid) window.clearTimeout(debounceTid);
      debounceTid = window.setTimeout(() => this._initialize(), 400);
    });

    // Stop work when window is not visible.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._stopStandbyAnimation();
      } else {
        this._startStandbyAnimation();
      }
    });

    this._initialize();
  }

  // Returns object { left, right, top, bottom }.
  _getOccupiedSpaceTotal() {
    const getRect = el => el.getBoundingClientRect();
    const topLevel = Array.from(document.body.children).map(getRect);
    const sized = topLevel.filter(r => r.left && r.top && r.width && r.height);
    let left, right, top, bottom;
    sized.forEach(r => {
      if (!r.left && !r.right && !r.top && !r.bottom) return;
      left = left ? min(left, r.left) : r.left;
      right = right ? max(right, r.right) : r.right;
      top = top ? min(top, r.top) : r.top;
      bottom = bottom ? max(bottom, r.bottom) : r.bottom;
    });
    return { left, right, top, bottom };
  }

  // Returns array of objects { left, right, top, bottom }.
  _getOccupiedSpaces() {
    const getRect = el => el.getBoundingClientRect();
    const topLevel = Array.from(document.body.children).map(getRect);
    const sized = topLevel.filter(r => r.left && r.top && r.width && r.height);
    const rs = sized.map(r => ({
      left: r.left, right: r.right, top: r.top, bottom: r.bottom
    }));
    const fillers = [];
    rs.forEach((r, i) => {
      if (!i) return;
      fillers.push({
        left: (r.left + rs[i-1].left) / 2,
        right: (r.right + rs[i-1].right) / 2,
        top: rs[i-1].bottom,
        bottom: r.top,
      });
    });
    return rs.concat(fillers);
  }

  // Params point { x, y }, occupied spaces array { left, right, top, bottom }.
  // Returns boolean.
  _pointOutsideOccupiedSpaces(p, oss) {
    const x = p.x + this._width / 2;
    const y = p.y + this._height / 2;
    const limLeft = x + this._size / 2 + this._pad + this._ospad;
    const limRight = x - this._size / 2 - this._pad - this._ospad;
    const limTop = y + this._size / 2 + this._pad + this._ospad;
    const limBottom = y - this._size / 2 - this._pad - this._ospad;
    const outsideX = (p, os) => limLeft <= os.left || limRight >= os.right;
    const outsideY = (p, os) => limTop <= os.top || limBottom >= os.bottom;
    return oss.every(os => outsideX(p, os) || outsideY(p, os));
  }

  // Params width, height, square size, padding between. Centered at { 0, 0 }.
  // Returns array of objects { x, y, i } to fill the space, i = ring index.
  _makeRayPattern() {
    const w = this._width;
    const h = this._height;
    const size = this._size;
    const pad = this._pad;
    const halfSize = size / 2;
    const halfDiag = sqrt(2 * pow(halfSize, 2));

    // Pad radius, outermost line of a ring.
    const pr = x => sqrt(pow(x + halfSize + pad, 2) + pow(halfSize + pad, 2));

    // Opposite coordinates in all quadrants.
    const four = ({ x, y, i }) => [
      { x: x, y: y, i }, { x: -x || 0, y: -y || 0, i }, // Avoid -0.
      { x: -y || 0, y: x, i }, { x: y, y: -x || 0, i }
    ];

    // Check intermediary positions between two points on the same circle.
    const inter = (p1, p2) => {
      const r = sqrt(pow(p1.x, 2) + pow(p1.y, 2)); // Circle radius.
      const a = (p1.y + p2.y) / (p1.x + p2.x); // Bisector slope.
      const x = r / sqrt(1 + pow(a, 2));
      const y = a * x;
      const d = sqrt(pow(x - p1.x, 2) + pow(p1.y - y, 2)); // Point distance.
      if (d < 2 * halfDiag + pad) return []; // No space.
      const p = { x, y, i: p1.i };
      return [p, ...inter(p1, p), ...inter(p, p2)];
    };

    // Fill space.
    let i = 0;
    let points = [{ x: 0, y: 0, i }];
    const stepSpace = (w + h) / 2; // Run over, will be cropped.
    const steps = floor(stepSpace / (size + pad));
    let lpr = pr(0); // Last pad radius.
    for (let j = 1; j <= steps; j++) {
      const x = j * (size + pad);
      if ((x - halfDiag) >= lpr) {
        i += 1;
        points.push(...four({ x, y: 0, i })); // Paint points on main axes.
        const fours = inter({ x: 0, y: x, i }, { x, y: 0, i }).map(four);
        fours.forEach(f => points.push(...f));
        lpr = pr(x);
      }
    }

    // Crop points to fit bounds.
    const lW = w / 2 - halfSize - 4; // A few pixels short of hitting side.
    const lH = h / 2 - halfSize - 4;
    const inside = p => p.x >= -lW && p.x <= lW && p.y >= -lH && p.y <= lH;
    points = points.filter(inside);

    return points;
  }

  // Params width, height, square size, padding between. Centered at { 0, 0 }.
  // Returns array of objects { x, y, i } to fill the space, i = ring index.
  _makeSquarePattern() {
    const w = this._width;
    const h = this._height;
    const size = this._size;
    const pad = this._pad;
    const full = size + pad;
    const diag = sqrt(2 * pow(full, 2));
    const halfSize = size / 2;
    const halfPad = pad / 2;
    const halfFull = full / 2;

    // Opposite coordinates in all quadrants.
    const four = ({ x, y, i }) => [
      { x: x, y: y, i }, { x: -x || 0, y: -y || 0, i }, // Avoid -0.
      { x: -y || 0, y: x, i }, { x: y, y: -x || 0, i }
    ];

    // Fill space.
    let points = [];
    const halfSquareSpaceDiag = sqrt(2 * pow(max(w, h), 2)) / 2;
    const stepSpace = ceil(halfSquareSpaceDiag / diag);
    for (let i = 0; i < stepSpace; i++) {
      const x = halfFull + i * full;
      points.push(...four({ x, y: x, i }));
      for (let j = x - full; j > 0; j -= full) {
        points.push(...four({ x, y: j, i }));
        points.push(...four({ x: j, y: x, i }));
      }
    }

    // Crop points to fit bounds.
    const lW = w / 2 - halfSize - halfPad; // A few pixels short of hitting side.
    const lH = h / 2 - halfSize - halfPad;
    const inside = p => p.x >= -lW && p.x <= lW && p.y >= -lH && p.y <= lH;
    points = points.filter(inside);

    return points;
  }

  // Params centered point { x, y, i }, canvas width and height, element size.
  // Returns positioned element with coordinates translated to top-left.
  _makePointElement(point) {
    const el = document.createElement('div');
    el.className = 'point';
    el.style.cssText = `
      top: ${point.y + this._height / 2 - this._size / 2}px;
      left: ${point.x + this._width / 2 - this._size / 2}px;
      width: ${this._size}px;
      height: ${this._size}px;
    `;
    el.point = point;
    el.nextTid = null;
    el.symbols = [];
    symbols.forEach(symbol => {
      const sel = document.createElement('div');
      sel.className = 'symbol';
      sel.innerHTML = symbol.svg;
      sel.href = symbol.href;
      el.symbols.push(sel);
      el.appendChild(sel);
    });
    return el;
  }

  // Params element, transform CSS string, delay in seconds.
  _animatePointTransform(el, transform, delay) {
    if (el.nextTid) window.clearTimeout(nextTid);
    if (delay === undefined) delay = 0;
    window.setTimeout(() => el.style.transform = transform, delay * 1000);
  }

  // Params element, symbol href, opacity, delay in seconds.
  _animateSymbolOpacity(el, href, opacity, delay) {
    if (el.nextTid) window.clearTimeout(nextTid);
    if (opacity === 0) opacity = 0.001; // Quirk: Prime layer for animation.
    if (delay === undefined) delay = 0;
    window.setTimeout(() => el.symbols.forEach(symbol => {
      symbol.style.opacity = (symbol.href === href) ? opacity : 0.001;
    }), delay * 1000);
  }

  // Params symbol href, delay in seconds.
  _animateBurst({ href, delay } = {}) {
    if (!href) href = symbols[floor(rnd() * symbols.length)].href; // Generic.
    if (delay === undefined) delay = 0;
    const firstRing = this._els[0].point.i;
    const ring = el => el.point.i - firstRing;
    const opacity = () => rnd() * 0.7;
    window.setTimeout(() => this._els.forEach(el => this._animateSymbolOpacity(
      el, href, opacity(), ring(el) * 0.02
    )), delay * 1000);
  }

  _animateStandby() {
    const href = () => symbols[floor(rnd() * symbols.length)].href; // Generic.
    const opacity = () => rnd() * 0.7;
    this._els.forEach(el => this._animateSymbolOpacity(el, href(), opacity()));
  }

  _startStandbyAnimation() {
    if (this._standbyIid) return;
    this._standbyIid = window.setInterval(() => this._animateStandby(), 4000);
  }

  _stopStandbyAnimation() {
    if (this._standbyIid) window.clearInterval(this._standbyIid);
    this._standbyIid = null;
  }

  _initialize() {
    this._width = max(this._root.clientWidth, window.innerWidth || 0);
    this._height = max(this._root.clientHeight, window.innerHeight || 0);
    const oss = this._getOccupiedSpaces();
    const unoccupied = p => this._pointOutsideOccupiedSpaces(p, oss);
    let points = this._makeRayPattern().filter(unoccupied);
    const firstRing = points[0].i;
    const lastRing = points[points.length - 1].i;
    const ringCount = lastRing - firstRing + 1;
    const knockout = p => rnd() < 0.3 + (p.i - firstRing + 1) / ringCount * 0.7;
    points = points.filter(knockout);
    this._els = points.map(p => this._makePointElement(p));
    this._els.forEach(el => this._canvas.appendChild(el));
    this._animateBurst({ delay: 0.5 });
    this._startStandbyAnimation();
  }
}

app.components.add('tapestry', Tapestry);
document.body.insertAdjacentHTML(
  'beforeend',
  '<div component="tapestry"></div>'
);
