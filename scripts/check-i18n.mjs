import zhCN from '../src/locales/zh-CN.js';
import enUS from '../src/locales/en-US.js';
import { CANONICAL_ENTITY_IDS } from '../src/core/config.js';

const zhKeys = new Set(Object.keys(zhCN));
const enKeys = new Set(Object.keys(enUS));

const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));

const emptyZh = [...zhKeys].filter((k) => typeof zhCN[k] !== 'string' || zhCN[k].trim() === '');
const emptyEn = [...enKeys].filter((k) => typeof enUS[k] !== 'string' || enUS[k].trim() === '');

const missingEntityEntries = [];
for (const id of CANONICAL_ENTITY_IDS) {
  for (const suffix of ['name', 'short', 'desc']) {
    const key = `unit.${id}.${suffix}`;
    if (!zhKeys.has(key)) missingEntityEntries.push(`zh-CN:${key}`);
    if (!enKeys.has(key)) missingEntityEntries.push(`en-US:${key}`);
  }
}

if (
  missingInEn.length > 0 ||
  missingInZh.length > 0 ||
  emptyZh.length > 0 ||
  emptyEn.length > 0 ||
  missingEntityEntries.length > 0
) {
  console.error('[check-i18n] FAILED:');
  if (missingInEn.length) console.error('  Missing in en-US:', missingInEn);
  if (missingInZh.length) console.error('  Missing in zh-CN:', missingInZh);
  if (emptyZh.length) console.error('  Empty values in zh-CN:', emptyZh);
  if (emptyEn.length) console.error('  Empty values in en-US:', emptyEn);
  if (missingEntityEntries.length) console.error('  Missing canonical entity keys:', missingEntityEntries);
  process.exit(1);
}

console.log(
  `[check-i18n] OK: ${zhKeys.size} keys 100% matched across zh-CN / en-US, all ${CANONICAL_ENTITY_IDS.length} canonical entities covered.`
);
