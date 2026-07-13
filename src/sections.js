import * as THREE from 'three';

export const SECTIONS = {
  entrance: {
    label:       'Entrance',
    tag:         'SECTION 01',
    emoji:       '🚪',
    color:       '#f5c518',
    description: 'The main entrance to the funeral grounds. Guests are received and directed from this point.',
    min: new THREE.Vector3(-7,  0,  7),
    max: new THREE.Vector3(10,  4, 14),
    spawnPoint: new THREE.Vector3(1, 0, 10),
  },
  membersTent: {
    label:       'Members Tent',
    tag:         'SECTION 02',
    emoji:       '⛺',
    color:       '#f0f0f0',
    description: 'Seating area for church members and congregation.',
    min: new THREE.Vector3(-50,  0, 15),
    max: new THREE.Vector3( 52,  4, 45),
    spawnPoint: new THREE.Vector3(1, 0, 30),
  },
 papasDecor: {
    label:       "Papa's Decor",
    tag:         'SECTION 03',
    emoji:       '🌹',
    color:       '#00e5ff',
    description: 'The central decorative display and resting place in honour of Apostle Kwadwo Safo Kantanka. Floral arrangements and tribute pieces.',
    min: new THREE.Vector3(-5,  0, 75),
    max: new THREE.Vector3( 8,  4, 122),
    spawnPoint: new THREE.Vector3(1, 0, 90),
  },
  specialGuestsNorth: {
    label:       'Special Guests (North)',
    tag:         'SECTION 04',
    emoji:       '⭐',
    color:       '#a78bfa',
    description: 'Reserved seating for special guests and dignitaries — north area.',
    min: new THREE.Vector3(-25.5, 0, 84.5),
    max: new THREE.Vector3(-23.0, 0, 115.0),
    spawnPoint: new THREE.Vector3(-24.67, 0, 100.34),
  },
  specialGuestsSouth: {
    label:       'Special Guests (South)',
    tag:         'SECTION 05',
    emoji:       '⭐',
    color:       '#a78bfa',
    description: 'Reserved seating for special guests and dignitaries — south area.',
    min: new THREE.Vector3(24.5, 0, 84.0),
    max: new THREE.Vector3(28.0, 0, 114.5),
    spawnPoint: new THREE.Vector3(25.93, 0, 99.97),
  },
  papasThrone: {
    label:       "Papa's Throne",
    tag:         'SECTION 06',
    emoji:       '👑',
    color:       '#f97316',
    description: "The ceremonial throne of Apostle Kwadwo Safo Kantanka — Ghana's pioneering inventor and founder of Kantanka Group.",
    min: new THREE.Vector3(-12.0, 0, 134.0),
    max: new THREE.Vector3(16.0, 0, 143.0),
    spawnPoint: new THREE.Vector3(1.33, 0, 135.82),
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