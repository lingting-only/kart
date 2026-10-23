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
    this._accelLocked = false;  // 油门是否处于锁定（持续加速）状态

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
      // Prevent long-press context menu (copy/select/paste menu)
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };

    // left cluster: lookBack & item, sliding steering pad
    const steer = document.createElement('div');
    steer.className = 'touch-steer';
    root.appendChild(steer);
    mk('lookBack', steer);
    mk('item', steer);
    this._mkSteerPad(steer);

    // right cluster: drift on top row, brake/gas on bottom
    const actions = document.createElement('div');
    actions.className = 'touch-actions';
    root.appendChild(actions);
    mk('drift', actions);
    mk('brake', actions);
    mk('accelerate', actions);

    // pause, top-right
    mk('pause', root);

    uiRoot.appendChild(root);
  }

  /** 滑动转向：手指按住左右滑动控制方向，不松开即可连续调整 */
  _mkSteerPad(parent) {
    const pad = document.createElement('div');
    pad.className = 'touch-steer-pad';
    pad.innerHTML = '<div class="steer-track"><div class="steer-thumb"></div><span class="steer-hint">◀ 方向 ▶</span></div>';
    parent.appendChild(pad);

    const track = pad.querySelector('.steer-track');
    const thumb = pad.querySelector('.steer-thumb');
    let active = false;

    const apply = (clientX) => {
      const r = track.getBoundingClientRect();
      const half = r.width / 2;
      let v = half > 0 ? (clientX - (r.left + half)) / half : 0;
      v = Math.max(-1, Math.min(1, v));
      if (Math.abs(v) < 0.08) v = 0;   // 死区，避免抖动
      const travel = Math.max(0, half - thumb.offsetWidth / 2);
      thumb.style.transform = `translateX(${v * travel}px)`;
      this.input.setSteer(v);
    };

    const onStart = (clientX) => {
      active = true;
      pad.classList.add('active');
      apply(clientX);
    };
    const onMove = (clientX) => {
      if (!active) return;
      apply(clientX);
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      pad.classList.remove('active');
      thumb.style.transform = 'translateX(0)';
      this.input.setSteer(0);
    };

    // 触屏（用 touch 事件，避免 pointermove 被默认滚动手势打断）
    pad.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches && e.touches[0];
      if (t) onStart(t.clientX);
    }, { passive: false });
    pad.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches && e.touches[0];
      if (t) onMove(t.clientX);
    }, { passive: false });
    pad.addEventListener('touchend', (e) => { e.preventDefault(); onEnd(); });
    pad.addEventListener('touchcancel', onEnd);

    // 桌面调试（鼠标）
    pad.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onStart(e.clientX);
      const mm = (ev) => onMove(ev.clientX);
      const mu = () => { onEnd(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    });
    pad.addEventListener('contextmenu', (e) => e.preventDefault());

    this._steerPad = pad;
    return pad;
  }

  _down(e, el, action) {
    e.preventDefault();
    e.stopPropagation();

    // 油门：点击锁定/解锁（toggle），松开不影响，直到再次点击或点刹车取消
    if (action === 'accelerate') {
      this._accelLocked = !this._accelLocked;
      this.input.setTouch('accelerate', this._accelLocked);
      el.classList.toggle('pressed', this._accelLocked);
      el.classList.toggle('locked', this._accelLocked);
      return;
    }

    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this._pointers.set(e.pointerId, action);
    el.classList.add('pressed');
    this.input.setTouch(action, true);

    // 刹车：取消油门锁定
    if (action === 'brake' && this._accelLocked) {
      this._accelLocked = false;
      this.input.setTouch('accelerate', false);
      const gas = this.root.querySelector('[data-action="accelerate"]');
      if (gas) gas.classList.remove('pressed', 'locked');
    }
  }

  _up(e, action) {
    if (action === 'accelerate') return;  // 油门是 toggle，松开不取消
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
      this._accelLocked = false;
      this.input.setSteer(0);
      for (const a of Object.keys(BUTTONS)) this.input.setTouch(a, false);
      for (const b of this.root.querySelectorAll('.tbtn.pressed, .tbtn.locked')) b.classList.remove('pressed', 'locked');
      const thumb = this.root.querySelector('.steer-thumb');
      if (thumb) thumb.style.transform = 'translateX(0)';
    }
  }

  dispose() {
    this.setVisible(false);
    this.root.remove();
  }
}
