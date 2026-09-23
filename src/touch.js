// On-screen touch controls for mobile: DOM buttons that feed InputController.setTouch().
// Multi-touch safe (one pointer per button via pointer capture), hidden outside race states.
export function isTouchDevice() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0 || (navigator.msMaxTouchPoints || 0) > 0;
  return coarse && touchCapable;
}

// action -> [glyph, label, cssClass]
const BUTTONS = {
  left:     { glyph: '◀', label: '', cls: 't-steer' },
  right:    { glyph: '▶', label: '', cls: 't-steer' },
  lookBack: { glyph: '', label: '视角', cls: 't-mini' },
  drift:    { glyph: '', label: '漂移', cls: '' },
  item:     { glyph: '', label: '道具', cls: '' },
  brake:    { glyph: '', label: '刹车', cls: '' },
  accelerate: { glyph: '', label: '油门', cls: 't-gas' },
  pause:    { glyph: 'Ⅱ', label: '', cls: 't-pause' },
};

export class TouchControls {
  constructor(uiRoot, input) {
    this.input = input;
    this.active = false;
    this._pointers = new Map(); // pointerId -> action

    const root = document.createElement('div');
    root.className = 'touch-ui hidden';
    this.root = root;

    const mk = (action, parent) => {
      const def = BUTTONS[action];
      const b = document.createElement('div');
      b.className = 'tbtn' + (def.cls ? ' ' + def.cls : '');
      b.dataset.action = action;
      b.innerHTML = def.glyph ? `<span class="t-glyph">${def.glyph}</span>` : `<span class="t-label">${def.label}</span>`;
      parent.appendChild(b);
      b.addEventListener('pointerdown', (e) => this._down(e, b, action));
      b.addEventListener('pointerup', (e) => this._up(e, action));
      b.addEventListener('pointercancel', (e) => this._up(e, action));
      b.addEventListener('lostpointercapture', (e) => this._up(e, action));
      return b;
    };

    // left cluster: look back above, steering arrows
    const steer = document.createElement('div');
    steer.className = 'touch-steer';
    root.appendChild(steer);
    mk('lookBack', steer);
    const arrows = document.createElement('div');
    arrows.className = 'touch-arrows';
    steer.appendChild(arrows);
    mk('left', arrows);
    mk('right', arrows);

    // right cluster: item/drift on top row, brake/gas on bottom
    const actions = document.createElement('div');
    actions.className = 'touch-actions';
    root.appendChild(actions);
    mk('item', actions);
    mk('drift', actions);
    mk('brake', actions);
    mk('accelerate', actions);

    // pause, top-right
    mk('pause', root);

    uiRoot.appendChild(root);
  }

  _down(e, el, action) {
    e.preventDefault();
    e.stopPropagation();
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this._pointers.set(e.pointerId, action);
    el.classList.add('pressed');
    this.input.setTouch(action, true);
  }

  _up(e, action) {
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.delete(e.pointerId);
    const el = e.currentTarget;
    if (el && el.classList) el.classList.remove('pressed');
    this.input.setTouch(action, false);
  }

  /** Show/hide. Hiding releases every held button so nothing stays stuck. */
  setVisible(v) {
    v = !!v;
    if (this.active === v) return;
    this.active = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) {
      this._pointers.clear();
      for (const a of Object.keys(BUTTONS)) this.input.setTouch(a, false);
      for (const b of this.root.querySelectorAll('.tbtn.pressed')) b.classList.remove('pressed');
    }
  }

  dispose() {
    this.setVisible(false);
    this.root.remove();
  }
}
