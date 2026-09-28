// RoomManager：房间创建/加入/离开/准备，以及玩家列表与房间状态的实时订阅。
import { supabase, getCurrentUser } from './supabase.js';
import { bus } from '../events.js';
import { MULTIPLAYER } from '../config.js';

export class RoomManager {
  constructor() {
    this.room = null;          // 当前房间 { id, name, state, host_id, player_count, ... }
    this.me = null;            // 当前玩家 { id, room_id, user_name, character, is_host, is_ready }
    this.players = [];         // 房间内玩家列表（实时）
    this._channels = [];       // Supabase Realtime channel 列表
    this._onPlayers = new Set();
    this._onRoomState = new Set();
  }

  // ---- 事件订阅（供 UI 使用） ----
  onPlayersChange(fn) { this._onPlayers.add(fn); return () => this._onPlayers.delete(fn); }
  onRoomStateChange(fn) { this._onRoomState.add(fn); return () => this._onRoomState.delete(fn); }

  async _ensureUser() {
    return getCurrentUser();
  }

  // ---- 查询 ----
  /** 列出可加入的房间（lobby 状态且未满员） */
  async listRooms() {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('state', 'lobby')
      .gt('player_count', 0)
      .lt('player_count', MULTIPLAYER.maxPlayers)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  /** 查询房间内已占用的角色 id 列表（用于新玩家随机分配不重复的角色） */
  async getOccupiedCharacters(roomId) {
    const { data, error } = await supabase
      .from('players')
      .select('character')
      .eq('room_id', roomId);
    if (error) return [];
    return (data || []).map((p) => p.character);
  }

  // ---- 创建房间 ----
  async createRoom({ name, character, laps = 3, difficulty = 'normal' }) {
    const user = await this._ensureUser();
    const { data: room, error } = await supabase
      .from('rooms')
      .insert({
        name,
        host_id: user.id,
        max_players: MULTIPLAYER.maxPlayers,
        laps,
        difficulty,
        state: 'lobby',
      })
      .select()
      .single();
    if (error) throw error;

    this.room = room;
    // 房主作为第一个玩家加入
    await this._insertPlayer(room.id, name, character, true);
    await this._subscribe(room.id);
    bus.emit('mp:joined', { room });
    return room;
  }

  // ---- 加入房间 ----
  async joinRoom(roomId, { name, character }) {
    await this._ensureUser();
    const { data: room, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();
    if (error) throw error;
    if (room.player_count >= MULTIPLAYER.maxPlayers) throw new Error('房间已满');

    // 检查房间是否已有房主，若无则自己成为房主（例如原房主已离开）
    const { data: host } = await supabase
      .from('players')
      .select('id')
      .eq('room_id', roomId)
      .eq('is_host', true)
      .maybeSingle();
    const isHost = !host;

    this.room = room;
    await this._insertPlayer(roomId, name, character, isHost);
    await this._subscribe(roomId);
    bus.emit('mp:joined', { room });
    return room;
  }

  async _insertPlayer(roomId, name, character, isHost) {
    const user = await this._ensureUser();
    // 清理该用户可能残留的旧记录（例如刷新页面未正常退出，匿名会话被复用导致主键冲突）
    await supabase.from('player_states').delete().eq('player_id', user.id);
    await supabase.from('players').delete().eq('id', user.id);

    const { data: player, error } = await supabase
      .from('players')
      .insert({
        id: user.id,             // players.id = auth.uid()
        room_id: roomId,
        user_name: name,
        character,
        is_ready: isHost,        // 房主默认已准备
        is_host: isHost,
      })
      .select()
      .single();
    if (error) throw error;
    this.me = player;
    return player;
  }

  // ---- 实时订阅 ----
  async _subscribe(roomId) {
    await this._unsubscribe();

    const playersCh = supabase
      .channel(`room-${roomId}-players`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'players',
        filter: `room_id=eq.${roomId}`,
      }, () => this._fetchPlayers())
      .subscribe();

    const roomCh = supabase
      .channel(`room-${roomId}-state`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rooms',
        filter: `id=eq.${roomId}`,
      }, (payload) => {
        this.room = payload.new;
        for (const fn of this._onRoomState) fn(payload.new);
        bus.emit('mp:roomState', payload.new);
      })
      .subscribe();

    this._channels = [playersCh, roomCh];
    await this._fetchPlayers();
  }

  async _fetchPlayers() {
    if (!this.room) return;
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', this.room.id)
      .order('created_at', { ascending: true });
    if (error) return;
    this.players = data || [];
    for (const fn of this._onPlayers) fn(this.players);
    bus.emit('mp:players', this.players);
  }

  // ---- 操作 ----
  async toggleReady() {
    if (!this.me) return;
    const next = !this.me.is_ready;
    await supabase.from('players').update({ is_ready: next }).eq('id', this.me.id);
  }

  async updateCharacter(character) {
    if (!this.me) return;
    await supabase.from('players').update({ character }).eq('id', this.me.id);
  }

  /** 房主开始比赛：房间状态切到 countdown */
  async startRace() {
    if (!this.me?.is_host || !this.room) return;
    await supabase.from('rooms').update({ state: 'countdown' }).eq('id', this.room.id);
  }

  async leaveRoom() {
    if (this.me) {
      const wasHost = this.me.is_host;
      const roomId = this.room?.id;
      await supabase.from('player_states').delete().eq('player_id', this.me.id);
      await supabase.from('players').delete().eq('id', this.me.id);
      // 房主离开时，把房主转移给房间内最早加入的剩余玩家
      if (wasHost && roomId) {
        const { data: nextHost } = await supabase
          .from('players')
          .select('id')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (nextHost) {
          await supabase.from('players').update({ is_host: true }).eq('id', nextHost.id);
        }
      }
    }
    await this._unsubscribe();
    this.room = null;
    this.me = null;
    this.players = [];
    bus.emit('mp:left');
  }

  async _unsubscribe() {
    for (const ch of this._channels) {
      try { await supabase.removeChannel(ch); } catch { /* ignore */ }
    }
    this._channels = [];
  }

  dispose() { this._unsubscribe(); }
}

export const roomManager = new RoomManager();
