import * as THREE from 'three';

// ── Section Definitions ──────────────────────────────────────────────────────
// Adjust min/max XZ coords after loading your model.
// Y range covers floor to ceiling (0 to 4 is safe default).
// spawnPoint is where the character teleports when you click the section button.
//
// HOW TO CALIBRATE:
//   1. Run the app, open browser console
//   2. Walk to each section corner and check the position logged in console
//   3. Update min/max values below to match

export const SECTIONS = {
  mainStage: {
    label:      'Main Stage',
    tag:        'SECTION 01',
    emoji:      '🎤',
    color:      '#ff4d4d',
    description: 'The main presentation area featuring the large backdrop screen, sponsor wall, and two presenter chairs. Primary content delivery zone.',
    min: new THREE.Vector3(-6,  0, -8),
    max: new THREE.Vector3( 3,  4, -1),
    spawnPoint: new THREE.Vector3(-1.5, 0, -3),
  },
  reception: {
    label:      'Reception',
    tag:        'SECTION 02',
    emoji:      '🪧',
    color:      '#ff8c42',
    description: 'The reception and check-in desk. Visitor entry point with branding displays and staff counter.',
    min: new THREE.Vector3( 1,  0, -4),
    max: new THREE.Vector3( 5,  4,  0),
    spawnPoint: new THREE.Vector3( 2.5, 0, -2),
  },
  controlRoom: {
    label:      'Control Room',
    tag:        'SECTION 03',
    emoji:      '🎛',
    color:      '#00e5ff',
    description: 'The enclosed HAWK.GG control and broadcast room. Houses technical equipment and provides a private meeting space.',
    min: new THREE.Vector3( 4,  0, -8),
    max: new THREE.Vector3(10,  4,  1),
    spawnPoint: new THREE.Vector3( 7,  0, -4),
  },
  gameArea: {
    label:      'Game Area',
    tag:        'SECTION 04',
    emoji:      '🎮',
    color:      '#f0f0f0',
    description: 'The interactive gaming zone with PC stations, monitor displays, and demo setups. Public engagement and hands-on experience area.',
    min: new THREE.Vector3(-6,  0,  0),
    max: new THREE.Vector3( 5,  4,  7),
    spawnPoint: new THREE.Vector3(-1,  0,  3),
  },
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
        this.onEnter(key); // triggers teleport
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
        if (this.onEnter) this.onEnter(found, false); // false = proximity trigger, not teleport
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
