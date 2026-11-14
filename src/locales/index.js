import zhCN from './zh-CN.js';
import enUS from './en-US.js';

export const BUILTIN_LOCALES = {
  'zh-CN': { label: '简体中文', dict: zhCN },
  'en-US': { label: 'English', dict: enUS }
};

export function normalizeLocaleCode(raw) {
  if (!raw || typeof raw !== 'string') return 'zh-CN';
  const lower = raw.trim().toLowerCase();
  if (lower === 'zh' || lower === 'zh-cn' || lower.startsWith('zh')) return 'zh-CN';
  if (lower === 'en' || lower === 'en-us' || lower.startsWith('en')) return 'en-US';
  return raw;
}
