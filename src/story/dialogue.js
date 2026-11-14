// Radio Portrait & Tactical Transmission Dialogue Box (T2.4).
// Uses strict .textContent updates (zero innerHTML / unsafe DOM sinks).

import { t } from '../core/i18n.js';

export function createDialogueController() {
  const boxEl = document.getElementById('dialogue-box');
  const portraitEl = document.getElementById('dialogue-portrait');
  const speakerEl = document.getElementById('dialogue-speaker');
  const textEl = document.getElementById('dialogue-text');

  let remainingSec = 0;
  let currentSpeakerKey = null;
  let currentTextKey = null;

  function renderText() {
    if (!currentTextKey) return;
    const speakerLabel = currentSpeakerKey
      ? (currentSpeakerKey.includes('.') ? t(currentSpeakerKey) : currentSpeakerKey)
      : 'EVA';
    const messageLabel = currentTextKey.includes('.') ? t(currentTextKey) : currentTextKey;
    speakerEl.textContent = speakerLabel;
    textEl.textContent = messageLabel;
  }

  function showDialogue(speakerKey, textKey, durationSec = 5.0, accentHex = '#2d7eff') {
    if (!boxEl) return;
    currentSpeakerKey = speakerKey;
    currentTextKey = textKey;
    remainingSec = durationSec;
    if (portraitEl) {
      portraitEl.style.borderColor = accentHex;
      portraitEl.textContent = speakerKey === 'crimson' ? 'CRIMSON' : 'EVA';
    }
    renderText();
    boxEl.hidden = false;
  }

  function hideDialogue() {
    remainingSec = 0;
    currentSpeakerKey = null;
    currentTextKey = null;
    if (boxEl) boxEl.hidden = true;
  }

  function update(dtSec) {
    if (remainingSec <= 0) return;
    remainingSec = Math.max(0, remainingSec - dtSec);
    if (remainingSec === 0) {
      hideDialogue();
    }
  }

  return {
    showDialogue,
    hideDialogue,
    refreshLocale: renderText,
    update
  };
}
