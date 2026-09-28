// RemoteKart：驱动远程玩家的视觉表现（位置/朝向插值 + 模型动画），不跑物理。
import * as THREE from 'three';
import { MULTIPLAYER } from '../config.js';

export class RemoteKart {
  constructor(kart, playerId) {
    this.kart = kart;
    this.playerId = playerId;
    this.target = new THREE.Vector3();
    this.targetHeading = 0;
    this.hasTarget = false;
    this.lastUpdate = 0;
  }

  /** 收到一条 player_states 快照时调用 */
  applyState(state) {
    if (!state) return;
    this.target.set(
      state.position_x ?? this.target.x,
      state.position_y ?? this.target.y,
      state.position_z ?? this.target.z,
    );
    this.targetHeading = state.heading ?? this.targetHeading;
    this.kart.speed = state.speed ?? 0;
    this.kart.trackT = state.track_t ?? this.kart.trackT;
    this.kart.lap = state.lap ?? this.kart.lap;
    this.kart.item = state.item ?? null;
    this.kart.finished = state.state === 'finished';

    if (!this.hasTarget) {
      // 第一次收到状态：直接吸附，避免从原点飞过来
      this.kart.position.copy(this.target);
      this.kart.heading = this.targetHeading;
      this.hasTarget = true;
    }
    this.lastUpdate = performance.now();
  }

  /** 每帧调用 */
  update(dt) {
    const k = this.kart;
    if (!this.hasTarget) return;

    // 位置指数平滑插值
    const a = 1 - Math.exp(-dt * MULTIPLAYER.interpRate);
    k.position.lerp(this.target, a);

    // 朝向插值（处理角度环绕）
    let d = this.targetHeading - k.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    k.heading = k.heading + d * (1 - Math.exp(-dt * MULTIPLAYER.headingRate));

    // 复用 Kart 内部的视觉动画（车身倾斜、轮子、漂移姿态）
    if (typeof k._animate === 'function') {
      try { k._animate(dt, 0, 1); } catch (e) { /* ignore */ }
    }
    k.time += dt;
  }

  dispose() {
    this.kart = null;
  }
}
