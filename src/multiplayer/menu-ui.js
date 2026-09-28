// MultiplayerMenu：多人模式首页 + 房间大厅 UI。
import { bus } from '../events.js';
import { CHARACTERS } from '../config.js';
import { roomManager } from './room-manager.js';

// 从剩余角色中随机选一个（排除已占用的），保证同房间内车手不重复
function randomCharacter(exclude = []) {
  const used = new Set(exclude);
  const available = CHARACTERS.filter((c) => !used.has(c.id));
  if (available.length === 0) return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id;
  return available[Math.floor(Math.random() * available.length)].id;
}

export class MultiplayerMenu {
  constructor(uiRoot, handlers = {}) {
    this.uiRoot = uiRoot;
    this.h = handlers; // { onBack }
    this.root = document.createElement('div');
    this.root.className = 'screen mp-screen';
    this.uiRoot.appendChild(this.root);

    this._unsubs = [
      roomManager.onPlayersChange((players) => this._renderPlayers(players)),
      roomManager.onRoomStateChange((room) => this._onRoomState(room)),
      bus.on('mp:joined', () => this.showLobby()),
    ];
  }

  show() {
    this._renderHome();
    this.root.classList.add('active');
  }
  hide() { this.root.classList.remove('active'); }

  _renderHome() {
    this.root.innerHTML = `
      <div class="mp-panel">
        <h2>多人模式</h2>
        <input id="mp-name" placeholder="你的昵称" value="${this._name()}" maxlength="12">
        <button id="mp-create" class="btn primary">创建房间</button>
        <button id="mp-quick" class="btn">快速匹配</button>
        <div id="mp-room-list" class="mp-room-list"></div>
        <button id="mp-back" class="btn">返回</button>
      </div>`;
    this.root.querySelector('#mp-create').onclick = () => this._create();
    this.root.querySelector('#mp-quick').onclick = () => this._quick();
    this.root.querySelector('#mp-back').onclick = () => { this.hide(); this.h.onBack?.(); };
    this._loadRooms();
  }

  _name() {
    return localStorage.getItem('tkr-mp-name') || ('车手' + Math.floor(Math.random() * 1000));
  }
  _saveName(name) {
    try { localStorage.setItem('tkr-mp-name', name); } catch { /* ignore */ }
  }

  async _loadRooms() {
    try {
      const rooms = await roomManager.listRooms();
      const list = this.root.querySelector('#mp-room-list');
      if (!list) return;
      if (!rooms.length) {
        list.innerHTML = '<div class="mp-empty">暂无可用房间，试试"快速匹配"</div>';
        return;
      }
      list.innerHTML = rooms.map((r) => `
        <div class="mp-room" data-id="${r.id}">
          <span>${r.name}</span>
          <span class="mp-room-meta">${r.player_count}/${r.max_players} 人</span>
          <button class="btn small" data-join="${r.id}">加入</button>
        </div>`).join('');
      list.querySelectorAll('[data-join]').forEach((b) => {
        b.onclick = () => this._join(b.dataset.join);
      });
    } catch (e) {
      console.error('[mp] list rooms failed', e);
    }
  }

  async _create() {
    const name = this.root.querySelector('#mp-name').value || this._name();
    this._saveName(name);
    try {
      await roomManager.createRoom({
        name: `${name} 的房间`,
        character: randomCharacter(),
        laps: 3,
        difficulty: 'normal',
      });
    } catch (e) { alert('创建房间失败：' + e.message); }
  }

  async _quick() {
    const name = this.root.querySelector('#mp-name').value || this._name();
    this._saveName(name);
    try {
      const rooms = await roomManager.listRooms();
      if (rooms.length) {
        const occupied = await roomManager.getOccupiedCharacters(rooms[0].id);
        await roomManager.joinRoom(rooms[0].id, { name, character: randomCharacter(occupied) });
      } else {
        await roomManager.createRoom({ name: `${name} 的房间`, character: randomCharacter(), laps: 3 });
      }
    } catch (e) { alert('匹配失败：' + e.message); }
  }

  async _join(roomId) {
    const name = this.root.querySelector('#mp-name').value || this._name();
    this._saveName(name);
    try {
      const occupied = await roomManager.getOccupiedCharacters(roomId);
      await roomManager.joinRoom(roomId, { name, character: randomCharacter(occupied) });
    } catch (e) { alert('加入失败：' + e.message); }
  }

  showLobby() {
    this.root.classList.add('active');
    this._renderLobby();
  }

  _renderLobby() {
    const room = roomManager.room;
    if (!room) return;
    const isHost = roomManager.me?.is_host;
    this.root.innerHTML = `
      <div class="mp-panel">
        <h2>房间：${room.name}</h2>
        <div class="mp-room-id">房间ID：<b>${room.id.slice(0, 8)}</b></div>
        <div id="mp-players" class="mp-players"></div>
        <div class="mp-actions">
          ${isHost ? '<button id="mp-start" class="btn primary">开始比赛</button>' : ''}
          <button id="mp-ready" class="btn">准备</button>
          <button id="mp-leave" class="btn">离开</button>
        </div>
      </div>`;

    this.root.querySelector('#mp-leave').onclick = async () => {
      await roomManager.leaveRoom();
      this._renderHome();
    };
    this.root.querySelector('#mp-ready').onclick = () => roomManager.toggleReady();
    const startBtn = this.root.querySelector('#mp-start');
    if (startBtn) startBtn.onclick = () => roomManager.startRace();
    this._renderPlayers(roomManager.players);
  }

  _renderPlayers(players) {
    const box = this.root.querySelector('#mp-players');
    if (!box) return;
    box.innerHTML = players.map((p) => `
      <div class="mp-player ${p.is_ready ? 'ready' : ''}">
        <span>${p.user_name}${p.is_host ? ' (房主)' : ''}</span>
        <span class="mp-player-status">${p.is_ready ? '✓ 已准备' : '等待中'}</span>
      </div>`).join('');
  }

  _onRoomState(room) {
    if (room.state === 'countdown' || room.state === 'racing') {
      bus.emit('mp:startRace', { room });
    }
  }

  dispose() {
    this._unsubs.forEach((u) => { try { u(); } catch { /* ignore */ } });
    this.root.remove();
  }
}
