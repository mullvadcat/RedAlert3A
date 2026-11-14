// Pure deterministic RNG, immutable-state visual hash, and zero-GC event bus.
// Zero DOM / WebGL dependencies so headless Node simulation and browser share exact logic.

export function createEventBus() {
  const listeners = new Map();

  return {
    on(eventName, fn) {
      let arr = listeners.get(eventName);
      if (!arr) {
        arr = [];
        listeners.set(eventName, arr);
      }
      arr.push(fn);
      return () => {
        const idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      };
    },
    off(eventName, fn) {
      const arr = listeners.get(eventName);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    emit(eventName, payload) {
      const arr = listeners.get(eventName);
      if (!arr || arr.length === 0) return;
      for (let i = 0; i < arr.length; i++) {
        arr[i](payload);
      }
    },
    clear() {
      listeners.clear();
    }
  };
}

// Mulberry32 advancing state.prngState strictly inside simulation ticks.
export function nextRandom(state) {
  let t = (state.prngState = (state.prngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextRandomInt(state, min, max) {
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}

// Pure stateless 32-bit visual hash for presentation effects (never mutates gameplay PRNG).
export function hash32(x) {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

export function hashFloat(x) {
  return hash32(x) / 4294967296;
}
