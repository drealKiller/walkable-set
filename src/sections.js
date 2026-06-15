import * as THREE from 'three';

export const SECTIONS = {
  // Sections cleared — add Event space sections here.
  // Shape:
  //   key: {
  //     label, tag, emoji, color, description,
  //     min: new THREE.Vector3(x, y, z),        // bounding-box corner
  //     max: new THREE.Vector3(x, y, z),        // bounding-box corner
  //     spawnPoint: new THREE.Vector3(x, y, z), // teleport target
  //   }
};

// ── Section Manager ───────────────────────────────────────────────────────────
export class SectionManager {
  constructor(onSectionEnter, onSectionExit) {
    this.onEnter = onSectionEnter;
    this.onExit  = onSectionExit;
    this.currentSection = null;

    this.popup      = document.getElementById('section-popup');
    this.popupTag   = document.getElementById('popup-tag');
    this.popupTitle = document.getElementById('popup-title');
    this.popupDesc  = document.getElementById('popup-desc');

    this.buttons = document.querySelectorAll('.section-btn');
    this._setupButtons();
  }

  _setupButtons() {
    this.buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.section;
        this.onEnter(key);
      });
    });
  }

  update(playerPos) {
    let found = null;
    for (const [key, sec] of Object.entries(SECTIONS)) {
      if (
        playerPos.x >= sec.min.x && playerPos.x <= sec.max.x &&
        playerPos.z >= sec.min.z && playerPos.z <= sec.max.z
      ) {
        found = key;
        break;
      }
    }

    if (found !== this.currentSection) {
      if (found) {
        this._showPopup(found);
        this._highlightButton(found);
        if (this.onEnter) this.onEnter(found, false);
      } else {
        this._hidePopup();
        this._highlightButton(null);
        if (this.onExit) this.onExit();
      }
      this.currentSection = found;
    }
  }

  _showPopup(key) {
    const sec = SECTIONS[key];
    this.popupTag.textContent   = sec.tag;
    this.popupTag.style.color   = sec.color;
    this.popupTitle.textContent = `${sec.emoji}  ${sec.label}`;
    this.popupTitle.style.color = sec.color;
    this.popupDesc.textContent  = sec.description;
    this.popup.classList.add('visible');
  }

  _hidePopup() {
    this.popup.classList.remove('visible');
  }

  _highlightButton(key) {
    this.buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === key);
    });
  }
}