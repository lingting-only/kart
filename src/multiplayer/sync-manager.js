// SyncManager：比赛进行时，把本地玩家状态按频率写入 player_states，并接收远程玩家状态。
import { supabase } from './supabase.js';
import { MULTIPLAYER } from '../config.js';

const SYNC_RATE = 1000 / MULTIPLAYER.syncRateHz; // ms/次

export class SyncManager {
  constructor() {
    this.roomId = null;
    this.meId = null;
    this.remote = new Map();   // playerId -> 最新状态快照
    this._lastSend = 0;
    this._channel = null;
  }

  async start(roomId, meId) {
    this.roomId = roomId;
    this.meId = meId;

    this._channel = supabase
      .channel(`room-${roomId}-states`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'player_states',
        filter: `room_id=eq.${roomId}`,
      }, (payload) => this._onChange(payload))
      .subscribe();
  }

  _onChange(payload) {
    const row = payload.new || payload.old;
    if (!row || row.player_id === this.meId) return; // 忽略自己
    if (payload.eventType === 'DELETE') {
      this.remote.delete(row.player_id);
    } else {
      this.remote.set(row.player_id, row);
    }
  }

  /** 每帧调用：把本地玩家状态按频率写入 player_states */
  broadcast(kart) {
    const now = performance.now();
    if (now - this._lastSend < SYNC_RATE) return;
    this._lastSend = now;
    if (!this.meId || !this.roomId) return;

    // 异步写入，内部吞掉错误，避免主循环里产生未处理的 rejection
    (async () => {
      try {
        await supabase.from('player_states').upsert({
          player_id: this.meId,
          room_id: this.roomId,
          position_x: kart.position.x,
          position_y: kart.position.y,
          position_z: kart.position.z,
          heading: kart.heading,
          speed: kart.speed,
          lap: kart.lap,
          track_t: kart.trackT,
          item: kart.item,
          state: kart.finished ? 'finished' : 'racing',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'player_id' });
      } catch (e) { /* 网络抖动时静默忽略，下一帧重试 */ }
    })();
  }

  /** 获取某个远程玩家的状态快照 */
  getRemote(playerId) {
    return this.remote.get(playerId) || null;
  }

  async stop() {
    if (this._channel) {
      try { await supabase.removeChannel(this._channel); } catch { /* ignore */ }
    }
    this._channel = null;
    this.remote.clear();
    this.roomId = null;
    this.meId = null;
  }
}

export const syncManager = new SyncManager();
