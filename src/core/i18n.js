// Pure ESM i18n runtime (zero window/document reads; callers pass initialLocale).
import { BUILTIN_LOCALES, normalizeLocaleCode } from '../locales/index.js';
import { createEventBus } from './events.js';

const registry = new Map();
for (const [code, entry] of Object.entries(BUILTIN_LOCALES)) {
  registry.set(code, { label: entry.label, dict: { ...entry.dict } });
}

let activeLocale = 'zh-CN';
let voiceLocale = 'zh-CN';
const bus = createEventBus();

export function registerLocale(code, label, dict) {
  const existing = registry.get(code);
  registry.set(code, {
    label: label || existing?.label || code,
    dict: { ...(existing?.dict ?? {}), ...(dict ?? {}) }
  });
}

export function initI18n(initialLocale = 'zh-CN', initialVoiceLocale = null) {
  const norm = normalizeLocaleCode(initialLocale);
  activeLocale = registry.has(norm) ? norm : 'zh-CN';
  const normVoice = initialVoiceLocale ? normalizeLocaleCode(initialVoiceLocale) : activeLocale;
  voiceLocale = registry.has(normVoice) ? normVoice : activeLocale;
  return activeLocale;
}

export function getLocale() {
  return activeLocale;
}

export function getVoiceLocale() {
  return voiceLocale;
}

export function setLocale(code) {
  const norm = normalizeLocaleCode(code);
  const next = registry.has(norm) ? norm : 'zh-CN';
  if (next === activeLocale) return next;
  activeLocale = next;
  bus.emit('locale:change', { locale: activeLocale, voiceLocale });
  return activeLocale;
}

export function setVoiceLocale(code) {
  const norm = normalizeLocaleCode(code);
  const next = registry.has(norm) ? norm : 'zh-CN';
  if (next === voiceLocale) return next;
  voiceLocale = next;
  bus.emit('locale:voiceChange', { locale: activeLocale, voiceLocale });
  return voiceLocale;
}

export function toggleLocale() {
  const next = activeLocale === 'zh-CN' ? 'en-US' : 'zh-CN';
  setVoiceLocale(next);
  return setLocale(next);
}

export function onLocaleChange(fn) {
  return bus.on('locale:change', fn);
}

export function t(key, params = null) {
  const activeDict = registry.get(activeLocale)?.dict;
  const zhDict = registry.get('zh-CN')?.dict;
  const enDict = registry.get('en-US')?.dict;
  let str = activeDict?.[key] ?? zhDict?.[key] ?? enDict?.[key] ?? key;
  if (params && typeof str === 'string') {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
