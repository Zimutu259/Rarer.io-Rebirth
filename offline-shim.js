/*
 * Offline shim for rarer.io. Overrides the global WebSocket so the game
 * client (which is unmodified) thinks it's talking to a real server, while
 * everything actually runs locally in this script. Ported 1:1 from the
 * protocol we reverse-engineered into rarer_server.py.
 *
 * MUST be loaded via a plain <script> tag BEFORE the game's
 * <script type="module" src="assets/index-....js"> tag, so this override
 * is in place before the game constructs its WebSocket.
 */
(() => {
  // -------------------------------------------------------------------
  // Aura kinds
  // -------------------------------------------------------------------
  const COMMON = 1, UNCOMMON = 2, RARE = 3, EPIC = 4, SPARK = 5, RIPPLE = 6,
        STELLAR = 7, ENRAGED = 8, CONFETTI = 9, FIREFLY = 10, TOXIC = 11,
        IGNITED = 12, STARFISH = 13, CHROMATIC = 14, VORTEX = 15, LOTUS = 16,
        ANGELIC = 17, STARBOARD = 18, INFERNO = 19, KALEIDOSCOPE = 20,
        ASTRAL = 21, DEMONIC = 22;

  const PRICES = {
    [COMMON]: 2, [UNCOMMON]: 4, [RARE]: 10, [EPIC]: 20, [SPARK]: 25,
    [RIPPLE]: 33, [STELLAR]: 50, [ENRAGED]: 200, [CONFETTI]: 400,
    [FIREFLY]: 1000, [TOXIC]: 2000, [IGNITED]: 2500, [STARFISH]: 3333,
    [CHROMATIC]: 5000, [VORTEX]: 20000, [LOTUS]: 40000, [ANGELIC]: 100000,
    [STARBOARD]: 200000, [INFERNO]: 250000, [KALEIDOSCOPE]: 333333,
    [ASTRAL]: 500000, [DEMONIC]: 2000000,
  };

  const RECIPES = {
    1: { required: [], weights: [
      [COMMON, 50000050], [UNCOMMON, 25000000], [RARE, 10000000], [EPIC, 5000000],
      [SPARK, 4000000], [RIPPLE, 3000000], [STELLAR, 2000000], [ENRAGED, 500000],
      [CONFETTI, 250000], [FIREFLY, 100000], [TOXIC, 50000], [IGNITED, 40000],
      [STARFISH, 30000], [CHROMATIC, 20000], [VORTEX, 5000], [LOTUS, 2500],
      [ANGELIC, 1000], [STARBOARD, 500], [INFERNO, 400], [KALEIDOSCOPE, 300],
      [ASTRAL, 200], [DEMONIC, 50],
    ]},
    2: { required: [[COMMON,1],[UNCOMMON,1],[RARE,1],[EPIC,1]], weights: [
      [RARE, 40000200], [EPIC, 20000000], [SPARK, 16000000], [RIPPLE, 12000000],
      [STELLAR, 8000000], [ENRAGED, 2000000], [CONFETTI, 1000000], [FIREFLY, 400000],
      [TOXIC, 200000], [IGNITED, 160000], [STARFISH, 120000], [CHROMATIC, 80000],
      [VORTEX, 20000], [LOTUS, 10000], [ANGELIC, 4000], [STARBOARD, 2000],
      [INFERNO, 1600], [KALEIDOSCOPE, 1200], [ASTRAL, 800], [DEMONIC, 200],
    ]},
    3: { required: [[SPARK,4]], weights: [
      [COMMON, 33940000], [SPARK, 60000000], [IGNITED, 6000000], [INFERNO, 60000],
    ]},
    4: { required: [[RIPPLE,4]], weights: [
      [COMMON, 33900000], [RIPPLE, 60000000], [STARFISH, 6000000], [STARBOARD, 100000],
    ]},
    5: { required: [[STELLAR,4]], weights: [
      [COMMON, 34950000], [STELLAR, 40000000], [FIREFLY, 25000000], [ASTRAL, 50000],
    ]},
    6: { required: [[CONFETTI,2]], weights: [
      [ENRAGED, 50005000], [CONFETTI, 25000000], [FIREFLY, 10000000], [TOXIC, 5000000],
      [IGNITED, 4000000], [STARFISH, 3000000], [CHROMATIC, 2000000], [VORTEX, 500000],
      [LOTUS, 250000], [ANGELIC, 100000], [STARBOARD, 50000], [INFERNO, 40000],
      [KALEIDOSCOPE, 30000], [ASTRAL, 20000], [DEMONIC, 5000],
    ]},
    7: { required: [[ENRAGED,3]], weights: [
      [COMMON, 49895000], [ENRAGED, 50000000], [ANGELIC, 100000], [DEMONIC, 5000],
    ]},
  };

  function rollWeighted(recipeKind) {
    const weights = (RECIPES[recipeKind] || RECIPES[1]).weights;
    let e = Math.floor(Math.random() * 100000000);
    for (const [kind, w] of weights) {
      if (e < w) return kind;
      e -= w;
    }
    return COMMON;
  }

  // -------------------------------------------------------------------
  // Packet kinds
  // -------------------------------------------------------------------
  const K_LOGIN_REQ = 1, K_LOGIN_RES = 2, K_ENTER_REQ = 3, K_ENTER_RES = 4,
        K_LEAVE_REQ = 5, K_LEAVE_RES = 6, K_INPUT = 7, K_STATE = 8,
        K_ROLL_REQ = 9, K_ROLL_RES = 10, K_ROLL_KEEP = 11, K_INV_REQ = 12,
        K_INV_RES = 13, K_INV_EQUIP = 14, K_INV_DISCARD = 15,
        K_USERNAME_REQ = 16, K_USERNAME_RES = 17, K_CHAT = 18,
        K_PLAYER_NAMES = 19, K_CRAFT_REQ = 20, K_CRAFT_RES = 21,
        K_LOBBY_REQ = 22, K_LOBBY_RES = 23, K_SHOP_REQ = 24, K_SHOP_RES = 25,
        K_UPGRADE_INV = 26;

  const LOGIN_NO_ACCOUNT = 1, LOGIN_GUEST = 2, LOGIN_DISCORD = 3;

  // -------------------------------------------------------------------
  // Binary reader / writer (big-endian, matches the client's DataView use)
  // -------------------------------------------------------------------
  class Reader {
    constructor(buf) { this.view = new DataView(buf); this.pos = 0; }
    u8() { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
    f32() { const v = this.view.getFloat32(this.pos); this.pos += 4; return v; }
    bool() { return this.u8() !== 0; }
    string() {
      const n = this.u8();
      const bytes = new Uint8Array(this.view.buffer, this.pos, n);
      this.pos += n;
      return new TextDecoder("utf-8").decode(bytes);
    }
    nullable(fn) { return this.bool() ? fn.call(this) : null; }
  }

  class Writer {
    constructor() { this.bytes = []; }
    u8(v) { this.bytes.push(v & 0xff); }
    f32(v) {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(0, v);
      this.bytes.push(...new Uint8Array(buf));
    }
    u32(v) {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setUint32(0, v);
      this.bytes.push(...new Uint8Array(buf));
    }
    bool(v) { this.u8(v ? 1 : 0); }
    string(s) {
      const enc = new TextEncoder().encode(s).slice(0, 255);
      this.u8(enc.length);
      this.bytes.push(...enc);
    }
    nullable(v, fn) {
      if (v === null || v === undefined) { this.bool(false); }
      else { this.bool(true); fn.call(this, v); }
    }
    array(items, fn) {
      this.u8(items.length);
      for (const it of items) fn.call(this, it);
    }
    arrayBuffer() { return new Uint8Array(this.bytes).buffer; }
  }

  // -------------------------------------------------------------------
  // Encoders (server -> client), matching the client's decoder exactly
  // -------------------------------------------------------------------
  function encLoginResponse(accountId, username, password, discordAvatarUrl) {
    const w = new Writer();
    w.u8(K_LOGIN_RES);
    w.string(accountId); w.string(username); w.string(password);
    w.nullable(discordAvatarUrl, w.string);
    return w.arrayBuffer();
  }
  function encEnterResponse(playerId) {
    const w = new Writer(); w.u8(K_ENTER_RES); w.u8(playerId);
    return w.arrayBuffer();
  }
  function encLeaveResponse() {
    const w = new Writer(); w.u8(K_LEAVE_RES); return w.arrayBuffer();
  }
  function encState(players) {
    const w = new Writer(); w.u8(K_STATE);
    w.array(players, function (p) {
      this.u8(p.id); this.f32(p.x); this.f32(p.y); this.f32(p.angle);
      this.nullable(p.equippedAura, this.u8);
      this.u32(p.numRolls);
      this.nullable(p.chatMessage, this.string);
    });
    return w.arrayBuffer();
  }
  function encPlayerNames(names) {
    const w = new Writer(); w.u8(K_PLAYER_NAMES);
    w.array(names, function (n) { this.u8(n.id); this.string(n.username); });
    return w.arrayBuffer();
  }
  function encRollResponse(recipeKind, rolledAura, replaceAura) {
    const w = new Writer(); w.u8(K_ROLL_RES);
    w.u8(recipeKind); w.u8(rolledAura); w.nullable(replaceAura, w.u8);
    return w.arrayBuffer();
  }
  function encInventoryResponse(auras, equippedIndex, inventorySize) {
    const w = new Writer(); w.u8(K_INV_RES);
    w.array(auras, w.u8); w.nullable(equippedIndex, w.u8); w.u32(inventorySize);
    return w.arrayBuffer();
  }
  function encUsernameResponse(failedReason) {
    const w = new Writer(); w.u8(K_USERNAME_RES);
    w.nullable(failedReason, w.string);
    return w.arrayBuffer();
  }
  function encCraftingResponse(auras) {
    const w = new Writer(); w.u8(K_CRAFT_RES); w.array(auras, w.u8);
    return w.arrayBuffer();
  }
  function encLobbyResponse(lobbies) {
    const w = new Writer(); w.u8(K_LOBBY_RES);
    w.array(lobbies, function (l) {
      this.u8(l.lobbyId); this.u8(l.currentPlayers); this.u8(l.maxPlayers);
    });
    return w.arrayBuffer();
  }
  function encShopResponse(money) {
    const w = new Writer(); w.u8(K_SHOP_RES); w.u32(money);
    return w.arrayBuffer();
  }

  // -------------------------------------------------------------------
  // Game state (single local player) + localStorage persistence
  // -------------------------------------------------------------------
  const WORLD_SIZE = 1200;
  const MOVE_SPEED = 220;
  const STARTING_INVENTORY_SIZE = 6;
  const SAVE_KEY = "rarerOfflineProfiles";

  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
    catch { return {}; }
  }
  function writeProfiles(profiles) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(profiles));
  }
  function genAccountId() { return "guest-" + Math.floor(Math.random() * 900000 + 100000); }
  function genPassword() { return "pw-" + Math.floor(Math.random() * 900000000 + 100000000); }

  function cheapestAuraIndex(auras) {
    if (!auras.length) return null;
    let best = 0;
    for (let i = 1; i < auras.length; i++) {
      if ((PRICES[auras[i]] || 0) < (PRICES[auras[best]] || 0)) best = i;
    }
    return best;
  }

  const player = {
    id: 1,
    accountId: null,
    password: null,
    username: "Guest",
    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,
    angle: 0,
    moveAngle: null,
    entered: false,
    numRolls: 0,
    money: 0,
    auras: [],
    equippedIndex: null,
    inventorySize: STARTING_INVENTORY_SIZE,
    chatMessage: null,
    pendingRoll: null,
  };

  function profileFromPlayer(p) {
    return {
      password: p.password, username: p.username, money: p.money,
      auras: p.auras, equippedIndex: p.equippedIndex, inventorySize: p.inventorySize,
      numRolls: p.numRolls,
    };
  }
  function applyProfile(p, profile) {
    p.password = profile.password;
    p.username = profile.username;
    p.money = profile.money || 0;
    p.auras = profile.auras ? profile.auras.slice() : [];
    p.equippedIndex = profile.equippedIndex ?? null;
    p.inventorySize = profile.inventorySize || STARTING_INVENTORY_SIZE;
    p.numRolls = profile.numRolls || 0;
  }
  function savePlayer(p) {
    if (!p.accountId) return;
    const profiles = loadProfiles();
    profiles[p.accountId] = profileFromPlayer(p);
    writeProfiles(profiles);
  }

  function isValidUsername(name) {
    return name.length >= 4 && name.length <= 15 && /^[a-zA-Z0-9]+$/.test(name);
  }

  function equippedAura(p) {
    if (p.equippedIndex === null || p.equippedIndex >= p.auras.length) return null;
    return p.auras[p.equippedIndex];
  }

  // -------------------------------------------------------------------
  // The fake WebSocket
  // -------------------------------------------------------------------
  class OfflineSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = OfflineSocket.CONNECTING;
      this.binaryType = "blob";
      this._loopTimer = null;
      setTimeout(() => {
        this.readyState = OfflineSocket.OPEN;
        this.dispatchEvent(new Event("open"));
        this._startGameLoop();
      }, 30);
    }

    send(data) {
      if (this.readyState !== OfflineSocket.OPEN) return;
      let bytes;
      // IMPORTANT: copy eagerly (slice), don't just view into the caller's
      // buffer - many clients reuse a single scratch buffer for encoding
      // every outgoing packet, which would get overwritten before any
      // deferred/async processing of this packet runs.
      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data.slice(0));
      } else if (ArrayBuffer.isView(data)) {
        bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      } else {
        return;
      }
      setTimeout(() => this._handlePacket(bytes.buffer), 5);
    }

    close() {
      if (this.readyState === OfflineSocket.CLOSED) return;
      this.readyState = OfflineSocket.CLOSED;
      if (this._loopTimer) clearInterval(this._loopTimer);
      this.dispatchEvent(new Event("close"));
    }

    _emitMessage(arrayBuffer) {
      if (this.readyState !== OfflineSocket.OPEN) return;
      const evt = new Event("message");
      evt.data = arrayBuffer;
      this.dispatchEvent(evt);
    }

    _startGameLoop() {
      this._loopTimer = setInterval(() => {
        if (!player.entered) return;
        const dt = 1 / 20;
        if (player.moveAngle !== null) {
          player.x += MOVE_SPEED * dt * Math.cos(player.moveAngle);
          player.y += MOVE_SPEED * dt * Math.sin(player.moveAngle);
          player.x = Math.max(0, Math.min(WORLD_SIZE, player.x));
          player.y = Math.max(0, Math.min(WORLD_SIZE, player.y));
        }
        this._emitMessage(encState([{
          id: player.id, x: player.x, y: player.y, angle: player.angle,
          equippedAura: equippedAura(player), numRolls: player.numRolls,
          chatMessage: player.chatMessage,
        }]));
        player.chatMessage = null;
        this._emitMessage(encPlayerNames([{ id: player.id, username: player.username }]));
      }, 50);
    }

    _handlePacket(buf) {
      const r = new Reader(buf);
      const kind = r.u8();

      switch (kind) {
        case K_LOGIN_REQ: {
          const method = r.u8();
          let accountId = "", password = "";
          if (method === LOGIN_GUEST) {
            accountId = r.string(); password = r.string();
          } else if (method === LOGIN_DISCORD) {
            r.string(); r.string(); r.string(); // code, accountId, password - discord unsupported offline
          }
          const profiles = loadProfiles();
          const existing = accountId ? profiles[accountId] : null;
          if (existing && existing.password === password) {
            player.accountId = accountId;
            applyProfile(player, existing);
          } else {
            player.accountId = accountId || genAccountId();
            player.password = genPassword();
            player.username = "Guest";
            savePlayer(player);
          }
          this._emitMessage(encLoginResponse(player.accountId, player.username, player.password, null));
          break;
        }
        case K_ENTER_REQ: {
          r.u8(); // lobbyId
          player.entered = true;
          if (window.__rarerOffline && window.__rarerOffline._bar) {
            window.__rarerOffline._bar.style.display = "none";
          }
          this._emitMessage(encEnterResponse(player.id));
          break;
        }
        case K_LEAVE_REQ: {
          player.entered = false;
          if (window.__rarerOffline && window.__rarerOffline._bar) {
            window.__rarerOffline._bar.style.display = "";
          }
          this._emitMessage(encLeaveResponse());
          break;
        }
        case K_INPUT: {
          player.angle = r.f32();
          player.moveAngle = r.nullable(r.f32);
          break;
        }
        case K_ROLL_REQ: {
          const recipeKind = r.u8();
          const recipe = RECIPES[recipeKind] || RECIPES[1];
          if (recipeKind !== 1) {
            const counts = {};
            for (const a of player.auras) counts[a] = (counts[a] || 0) + 1;
            for (const [need, count] of recipe.required) {
              if ((counts[need] || 0) < count) return; // not enough mats
            }
            for (const [need, count] of recipe.required) {
              let removed = 0;
              player.auras = player.auras.filter(a => {
                if (a === need && removed < count) { removed++; return false; }
                return true;
              });
            }
          }
          const rolled = rollWeighted(recipeKind);
          player.numRolls++;
          let replaceIdx = null, replaceAura = null;
          if (player.auras.length >= player.inventorySize) {
            replaceIdx = cheapestAuraIndex(player.auras);
            replaceAura = replaceIdx !== null ? player.auras[replaceIdx] : null;
          }
          player.pendingRoll = { recipeKind, rolled, replaceIdx };
          this._emitMessage(encRollResponse(recipeKind, rolled, replaceAura));
          break;
        }
        case K_ROLL_KEEP: {
          const isKeeping = r.bool();
          if (player.pendingRoll) {
            const { rolled, replaceIdx } = player.pendingRoll;
            if (isKeeping) {
              if (replaceIdx !== null) player.auras[replaceIdx] = rolled;
              else player.auras.push(rolled);
              if (player.equippedIndex !== null && player.equippedIndex >= player.auras.length) {
                player.equippedIndex = null;
              }
            } else {
              player.money += PRICES[rolled] || 0;
            }
            player.pendingRoll = null;
            savePlayer(player);
          }
          break;
        }
        case K_INV_REQ: {
          this._emitMessage(encInventoryResponse(player.auras, player.equippedIndex, player.inventorySize));
          break;
        }
        case K_INV_EQUIP: {
          const index = r.u8(); r.u8();
          if (index >= 0 && index < player.auras.length) {
            player.equippedIndex = player.equippedIndex === index ? null : index;
            savePlayer(player);
          }
          this._emitMessage(encInventoryResponse(player.auras, player.equippedIndex, player.inventorySize));
          break;
        }
        case K_INV_DISCARD: {
          const index = r.u8(); r.u8();
          if (index >= 0 && index < player.auras.length) {
            const sold = player.auras.splice(index, 1)[0];
            player.money += PRICES[sold] || 0;
            if (player.equippedIndex !== null) {
              if (player.equippedIndex === index) player.equippedIndex = null;
              else if (player.equippedIndex > index) player.equippedIndex--;
            }
            savePlayer(player);
          }
          this._emitMessage(encInventoryResponse(player.auras, player.equippedIndex, player.inventorySize));
          break;
        }
        case K_USERNAME_REQ: {
          const username = r.string();
          if (!isValidUsername(username)) {
            this._emitMessage(encUsernameResponse("Can only contain letters/numbers, 4-15 characters."));
          } else {
            player.username = username;
            savePlayer(player);
            this._emitMessage(encUsernameResponse(null));
          }
          break;
        }
        case K_CHAT: {
          player.chatMessage = r.string();
          break;
        }
        case K_CRAFT_REQ: {
          this._emitMessage(encCraftingResponse(player.auras));
          break;
        }
        case K_LOBBY_REQ: {
          this._emitMessage(encLobbyResponse([{ lobbyId: 1, currentPlayers: player.entered ? 1 : 0, maxPlayers: 50 }]));
          break;
        }
        case K_SHOP_REQ: {
          this._emitMessage(encShopResponse(player.money));
          break;
        }
        case K_UPGRADE_INV: {
          if (player.money >= 5000) {
            player.money -= 5000;
            player.inventorySize += 1;
            savePlayer(player);
          }
          this._emitMessage(encShopResponse(player.money));
          break;
        }
      }
    }
  }
  OfflineSocket.CONNECTING = 0;
  OfflineSocket.OPEN = 1;
  OfflineSocket.CLOSING = 2;
  OfflineSocket.CLOSED = 3;

  window.WebSocket = OfflineSocket;

  // -------------------------------------------------------------------
  // Username bar - the game only normally offers a username prompt right
  // after Discord login, which we don't support offline. This gives an
  // equivalent way to set/save a username, using the same validation and
  // save path as the real flow.
  // -------------------------------------------------------------------
  function setUsername(name) {
    name = (name || "").trim();
    if (!isValidUsername(name)) {
      return { ok: false, reason: "4-15 characters, letters and numbers only." };
    }
    player.username = name;
    savePlayer(player);
    return { ok: true };
  }

  window.__rarerOffline = {
    getUsername: () => player.username,
    setUsername,
  };

  function buildUsernameBar() {
    const bar = document.createElement("div");
    bar.style.cssText = [
      "display:flex", "gap:6px", "align-items:center", "justify-content:center",
      "font-family:sans-serif", "font-size:13px", "margin-bottom:10px",
    ].join(";");

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Username";
    input.value = player.username === "Guest" ? "" : player.username;
    input.maxLength = 15;
    input.style.cssText = "padding:6px 8px;border-radius:6px;border:1px solid #0006;width:120px;font-size:13px;";

    const btn = document.createElement("button");
    btn.textContent = "Set";
    btn.style.cssText = "padding:6px 10px;border-radius:6px;border:0;background:#4caf50;color:#fff;cursor:pointer;font-weight:600;font-size:13px;";

    const msg = document.createElement("span");
    msg.style.cssText = "color:#fff;text-shadow:0 0 3px #000;font-size:12px;max-width:160px;";

    function submit() {
      const result = setUsername(input.value);
      msg.textContent = result.ok ? "Saved!" : result.reason;
      msg.style.color = result.ok ? "#8f8" : "#f88";
      if (result.ok) setTimeout(() => { msg.textContent = ""; }, 2000);
    }
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    bar.append(input, btn, msg);

    // The server-selector <select> doesn't exist yet at this point (the
    // game module hasn't run), so poll briefly until it appears, then
    // insert the bar as its previous sibling so it flows naturally above
    // it in the existing menu layout.
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      const select = document.querySelector("select");
      if (select && select.parentElement) {
        select.parentElement.insertBefore(bar, select);
        clearInterval(poll);
        window.__rarerOffline._bar = bar;
      } else if (attempts > 100) { // ~10s timeout
        clearInterval(poll);
      }
    }, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildUsernameBar);
  } else {
    buildUsernameBar();
  }
})();
