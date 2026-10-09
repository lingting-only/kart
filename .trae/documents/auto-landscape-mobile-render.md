# 手机竖屏自动横屏渲染方案

## 摘要（Summary）

在触屏手机处于**竖屏**时，不再用「请旋转设备」遮罩阻挡游戏，而是将整个游戏视图自动旋转 90° 渲染成横屏方向，用户无需物理横置手机即可直接游玩。

核心思路：CSS `transform` 把 `#game-root` 旋转 90° 并居中铺满竖屏视口；JS 侧把 WebGL 渲染缓冲区与相机的宽高按「横屏逻辑尺寸」交换（宽 = 竖屏高、高 = 竖屏宽），保证画布 1:1 无拉伸。

## 现状分析（Current State）

- [index.html](file:///d:/gitWork/kart/index.html) 第 27-31 行已有 `#rotate-notice` 遮罩（“请旋转设备 / 横屏模式可获得最佳体验”）。
- [styles.css](file:///d:/gitWork/kart/src/styles.css#L504-L517) 用三个媒体查询控制：
  - `(pointer: coarse) and (max-aspect-ratio: 1/1)` → 竖屏：显示遮罩、`#game-root{display:none}` 隐藏游戏；
  - `(pointer: coarse) and (min-aspect-ratio: 1/1)` → 横屏：隐藏遮罩、显示游戏；
  - `(pointer: fine)` → 桌面：强制显示游戏。
- [main.js](file:///d:/gitWork/kart/src/main.js#L40-L58) 渲染器/相机/后处理初始尺寸均读取 `window.innerWidth / innerHeight`；[onResize](file:///d:/gitWork/kart/src/main.js#L62-L70) 在 `resize` 事件时刷新，未处理竖屏交换逻辑。
- `#game-root` 基础样式为 `position:fixed; inset:0; overflow:hidden`（[styles.css](file:///d:/gitWork/kart/src/styles.css#L27-L29)），其内 `#game-canvas` 为 `inset:0; width:100%; height:100%`。
- `TouchControls`（[touch.js](file:///d:/gitWork/kart/src/touch.js)）的按钮 DOM 都在 `#ui-root` 内，随 `#game-root` 一起被 CSS 旋转，`pointerdown/pointerup` 坐标命中会随 transform 自动正确映射，无需改动。
- `isTouchDevice()` 已在 [main.js](file:///d:/gitWork/kart/src/main.js#L13) 静态导入，可直接复用。

## 方案改动（Proposed Changes）

### 1. src/styles.css —— 替换旋转遮罩相关媒体查询

将 [styles.css](file:///d:/gitWork/kart/src/styles.css#L504-L517) 的第 504-517 行整段替换为：

```css
/* 触屏竖屏：自动把游戏旋转成横屏渲染，而非用「请旋转设备」遮罩阻挡 */
@media (pointer: coarse) and (max-aspect-ratio: 1/1) {
  .rotate-notice { display: none; }
  #game-root {
    inset: auto;
    top: 50%;
    left: 50%;
    /* 横屏逻辑尺寸：宽=竖屏高，高=竖屏宽（JS 侧会用像素值覆盖宽高，保证与渲染缓冲区 1:1） */
    width: 100vh;
    height: 100vw;
    transform: translate(-50%, -50%) rotate(90deg);
  }
}
@media (pointer: coarse) and (min-aspect-ratio: 1/1) {
  .rotate-notice { display: none; }
  #game-root { transform: none; }
}
/* 桌面：始终正常显示 */
@media (pointer: fine) {
  .rotate-notice { display: none !important; }
  #game-root { transform: none !important; }
}
```

要点：
- `inset:auto` 覆盖基础样式里 `inset:0`，再用 `top/left:50%` + `translate(-50%,-50%)` 居中，`rotate(90deg)` 顺时针旋 90°，使横屏画面铺满竖屏视口。
- 横屏（物理横置）与桌面分支把 `transform` 复位，保持原有行为。

### 2. src/main.js —— 渲染尺寸按竖屏交换

(1) 在 [main.js](file:///d:/gitWork/kart/src/main.js#L36-L37) 附近补一个根容器引用（贴齐现有 `canvas`/`uiRoot` 声明）：

```js
const gameRoot = document.getElementById('game-root');
```

(2) 用「竖屏交换尺寸」版本替换 [onResize](file:///d:/gitWork/kart/src/main.js#L62-L70)：

```js
function onResize() {
  const portrait = isTouchDevice() && window.innerHeight > window.innerWidth;
  const w = portrait ? window.innerHeight : window.innerWidth;
  const h = portrait ? window.innerWidth : window.innerHeight;
  // 直接写入像素宽高，保证与 renderer.setSize 的缓冲区尺寸严格一致、无拉伸
  if (portrait) {
    gameRoot.style.width = window.innerHeight + 'px';
    gameRoot.style.height = window.innerWidth + 'px';
  } else {
    gameRoot.style.width = '';
    gameRoot.style.height = '';
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w, h);
}
window.addEventListener('resize', onResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
onResize(); // 页面首屏即竖屏打开时，立即应用横屏逻辑尺寸
```

要点：
- `renderer.setSize(w,h,false)` 的第三参为 `false`，只改绘制缓冲不改 canvas 的 CSS；canvas CSS 由 `#game-root` 的 `width/height:100%` 决定，被 JS 写成与缓冲一致的像素值 → 1:1。
- `visualViewport.resize` 兜底移动端地址栏收起/展开引发的 `innerHeight` 变化但未触发 `window.resize` 的场景。
- 首屏竖屏加载时，初始内联的 `setSize(innerWidth,innerHeight)` 会被紧随其后的 `onResize()` 覆盖为横屏逻辑尺寸，无需改动第 40/47/55/58 行的初始代码。

## 假设与决策（Assumptions & Decisions）

- **旋转方向**：采用 `rotate(90deg)`（顺时针）。游戏为左右对称的卡丁车操控，任一方向均可游玩，顺时针为常规默认。
- **不再阻挡**：去掉「请旋转设备」遮罩的阻挡行为；`#rotate-notice` 在竖屏触屏也保持 `display:none`（保留 DOM，便于未来改作一次性提示）。
- **不使用** `screen.orientation.lock()` / 全屏 API：iOS Safari 等环境不支持可靠锁定，CSS transform 方案兼容性最好、改动最小，符合当前无构建步骤的架构。
- **安全区**：旋转后 `env(safe-area-inset-*)` 相对刘海位置有轻微偏移，属可接受的美观问题，本次不做 `safe-area` 动态重映射（避免过度设计）。

## 验证步骤（Verification）

1. 本地启动静态服务：项目根目录 `python -m http.server 8080`，访问 `http://localhost:8080`。
2. 桌面浏览器开发者工具 → 切换到移动设备模拟（iPhone 竖屏 390×844），或在真机竖屏打开：
   - 应看到游戏**自动横屏渲染**（画面被旋转 90° 铺满屏幕），不再出现「请旋转设备」遮罩。
   - 标题 → 选人 → 比赛全流程 UI 正常、触摸按钮（油门/刹车/漂移/道具/转向）位置正确、可正常操作。
3. 真机物理横置（或模拟切换到横屏）：画面应恢复为正常横屏，无二次旋转、无黑边、无拉伸。
4. 竖屏切换横屏来回旋转，确认画布无模糊/拉伸、无撕裂，`resize` 正确更新相机宽高比。
5. 桌面浏览器（`pointer: fine`）回归：行为不变，游戏正常全屏显示。