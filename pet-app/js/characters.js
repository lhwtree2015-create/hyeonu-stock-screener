// 캐릭터 그림 (디자인 캔버스의 대표 6종 + 털색 8가지)
const INK = '#3B2A1A';

export const FURS = [
  ['white', '흰색', '#FFFDF8'],
  ['cream', '크림', '#F6E3BE'],
  ['apricot', '살구', '#F0AE72'],
  ['brown', '갈색', '#B07A4A'],
  ['choco', '초코', '#6E4A2E'],
  ['black', '검정', '#2E2A2A'],
  ['gray', '회색', '#A9A9A9'],
  ['gold', '황금', '#E3B05B'],
];
export const furHex = (k) => (FURS.find((f) => f[0] === k) || FURS[0])[2];
export const furLabel = (k) => (FURS.find((f) => f[0] === k) || FURS[0])[1];

export const SPECIES = {
  maltese: { label: '말티즈', kind: 'dog', fur: 'white' },
  poodle: { label: '푸들', kind: 'dog', fur: 'apricot' },
  golden: { label: '골든리트리버', kind: 'dog', fur: 'gold' },
  cheese: { label: '치즈냥', kind: 'cat', fur: 'apricot' },
  black: { label: '검정냥', kind: 'cat', fur: 'black' },
  calico: { label: '삼색냥', kind: 'cat', fur: 'white' },
};

function mix(hex, target, f) {
  const h = hex.replace('#', '');
  const t = target.replace('#', '');
  const c = [0, 2, 4].map((i) => {
    const a = parseInt(h.slice(i, i + 2), 16);
    const b = parseInt(t.slice(i, i + 2), 16);
    return Math.round(a + (b - a) * f)
      .toString(16)
      .padStart(2, '0');
  });
  return '#' + c.join('');
}
const darker = (h, f = 0.2) => mix(h, '#000000', f);
const lighter = (h, f = 0.5) => mix(h, '#ffffff', f);

function head(species, fur) {
  const s = `stroke="${INK}" stroke-width="3"`;
  switch (species) {
    case 'poodle':
      return `<circle cx="22" cy="62" r="17" fill="${fur}" ${s}/><circle cx="98" cy="62" r="17" fill="${fur}" ${s}/>
<circle cx="44" cy="26" r="14" fill="${fur}" ${s}/><circle cx="60" cy="20" r="14" fill="${fur}" ${s}/><circle cx="76" cy="26" r="14" fill="${fur}" ${s}/>
<circle cx="60" cy="56" r="34" fill="${fur}" ${s}/>`;
    case 'golden':
      return `<ellipse cx="24" cy="64" rx="13" ry="27" fill="${darker(fur)}" ${s} transform="rotate(8 24 64)"/><ellipse cx="96" cy="64" rx="13" ry="27" fill="${darker(fur)}" ${s} transform="rotate(-8 96 64)"/>
<circle cx="60" cy="56" r="34" fill="${fur}" ${s}/><ellipse cx="60" cy="72" rx="17" ry="12" fill="${lighter(fur)}" ${s}/>`;
    case 'cheese':
      return `<path d="M28 46 L22 12 L52 30Z" fill="${fur}" ${s} stroke-linejoin="round"/><path d="M92 46 L98 12 L68 30Z" fill="${fur}" ${s} stroke-linejoin="round"/>
<path d="M30 38 L27 22 L42 31Z M90 38 L93 22 L78 31Z" fill="#E88A9A"/><circle cx="60" cy="56" r="34" fill="${fur}" ${s}/>
<path d="M52 28 V40 M60 25 V40 M68 28 V40" stroke="${darker(fur, 0.25)}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M24 66 H42 M24 73 H42 M96 66 H78 M96 73 H78" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
    case 'black':
      return `<path d="M28 46 L22 12 L52 30Z" fill="${fur}" ${s} stroke-linejoin="round"/><path d="M92 46 L98 12 L68 30Z" fill="${fur}" ${s} stroke-linejoin="round"/>
<path d="M30 38 L27 22 L42 31Z M90 38 L93 22 L78 31Z" fill="#E88A9A"/><circle cx="60" cy="56" r="34" fill="${fur}" ${s}/>
<path d="M24 66 H42 M24 73 H42 M96 66 H78 M96 73 H78" stroke="${fur === '#2E2A2A' ? '#8A7F78' : INK}" stroke-width="2" stroke-linecap="round"/>`;
    case 'calico':
      return `<path d="M28 46 L22 12 L52 30Z" fill="#E88F3D" ${s} stroke-linejoin="round"/><path d="M92 46 L98 12 L68 30Z" fill="#2E2A2A" ${s} stroke-linejoin="round"/>
<path d="M30 38 L27 22 L42 31Z M90 38 L93 22 L78 31Z" fill="#E88A9A"/><circle cx="60" cy="56" r="34" fill="${fur}" ${s}/>
<ellipse cx="44" cy="38" rx="11" ry="9" fill="#E88F3D"/><ellipse cx="80" cy="40" rx="10" ry="9" fill="#2E2A2A"/>
<path d="M24 66 H42 M24 73 H42 M96 66 H78 M96 73 H78" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
    case 'maltese':
    default:
      return `<ellipse cx="26" cy="58" rx="14" ry="22" fill="${fur}" ${s} transform="rotate(12 26 58)"/><ellipse cx="94" cy="58" rx="14" ry="22" fill="${fur}" ${s} transform="rotate(-12 94 58)"/>
<circle cx="48" cy="26" r="10" fill="${fur}" ${s}/><circle cx="60" cy="22" r="10" fill="${fur}" ${s}/><circle cx="72" cy="26" r="10" fill="${fur}" ${s}/>
<circle cx="60" cy="56" r="34" fill="${fur}" ${s}/>`;
  }
}

function face(species, mood, furColor) {
  const cat = SPECIES[species] && SPECIES[species].kind === 'cat';
  const yellowEyes = species === 'black';
  const dark = furColor === '#2E2A2A' || furColor === '#6E4A2E';
  const line = dark ? '#F3E9DA' : INK;
  let eyes = '';
  if (mood === 'happy') {
    eyes = `<path d="M38 60 Q46 50 54 60 M66 60 Q74 50 82 60" stroke="${line}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  } else if (mood === 'sleep') {
    eyes = `<path d="M38 58 Q46 64 54 58 M66 58 Q74 64 82 58" stroke="${line}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  } else if (yellowEyes) {
    eyes = `<circle cx="46" cy="58" r="8" fill="#F2C94C" stroke="${INK}" stroke-width="2"/><circle cx="74" cy="58" r="8" fill="#F2C94C" stroke="${INK}" stroke-width="2"/>
<ellipse cx="46" cy="58" rx="2.6" ry="6" fill="${INK}"/><ellipse cx="74" cy="58" rx="2.6" ry="6" fill="${INK}"/>`;
  } else {
    const ec = dark ? '#1A120B' : INK;
    eyes = `<circle cx="46" cy="58" r="7" fill="${ec}"/><circle cx="74" cy="58" r="7" fill="${ec}"/><circle cx="48" cy="56" r="2.4" fill="#fff"/><circle cx="76" cy="56" r="2.4" fill="#fff"/>`;
  }
  let brows = '';
  let tears = '';
  if (mood === 'sad') {
    brows = `<path d="M38 46 L54 51 M82 46 L66 51" stroke="${line}" stroke-width="3" stroke-linecap="round"/>`;
    tears = `<path d="M44 68 Q40 78 44 82 Q49 78 44 68Z M76 68 Q72 78 76 82 Q81 78 76 68Z" fill="#7CC4F0" stroke="${INK}" stroke-width="1.5"/>`;
  }
  const nose = cat
    ? `<ellipse cx="60" cy="68" rx="4" ry="3" fill="#E88A9A"/>`
    : `<ellipse cx="60" cy="68" rx="5" ry="3.5" fill="${dark ? '#1A120B' : INK}"/>`;
  let mouth;
  if (mood === 'sad') mouth = `<path d="M52 79 Q60 73 68 79" stroke="${line}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  else if (mood === 'happy') mouth = `<path d="M50 75 Q60 90 70 75Z" fill="#E88A9A" stroke="${line}" stroke-width="2.5" stroke-linejoin="round"/>`;
  else if (mood === 'sleep') mouth = `<ellipse cx="60" cy="78" rx="3" ry="2.5" fill="none" stroke="${line}" stroke-width="2"/>`;
  else mouth = `<path d="M53 75 Q56.5 80 60 75 Q63.5 80 67 75" stroke="${line}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  return brows + eyes + tears + nose + mouth;
}

function heart(cx, cy) {
  return `M${cx} ${cy + 8} C${cx - 15} ${cy - 2} ${cx - 8} ${cy - 13} ${cx} ${cy - 5} C${cx + 8} ${cy - 13} ${cx + 15} ${cy - 2} ${cx} ${cy + 8}Z`;
}

/**
 * 캐릭터 SVG
 * @param {object} pet {species, fur, costume, name}
 * @param {object} opt {size, mood: sad|normal|happy|sleep, preview: {slot:id}}
 */
export function petSVG(pet, opt = {}) {
  const species = (pet && pet.species) || 'maltese';
  const fur = furHex((pet && pet.fur) || 'white');
  const size = opt.size || 100;
  const mood = opt.mood || 'sad';
  const costume = { ...((pet && pet.costume) || {}), ...(opt.preview || {}) };
  const label = opt.label || `${(SPECIES[species] || SPECIES.maltese).label} 캐릭터${pet && pet.name ? ' ' + pet.name : ''}`;
  const s = `stroke="${INK}" stroke-width="3"`;

  let body;
  if (costume.suit === 'suit_banana') {
    body = `<ellipse cx="60" cy="100" rx="40" ry="28" fill="#F2C94C" ${s}/><path d="M32 98 Q60 122 88 98" stroke="#B8901F" stroke-width="3" fill="none"/>`;
  } else if (costume.suit === 'suit_frog') {
    body = `<ellipse cx="60" cy="100" rx="40" ry="28" fill="#7BBF6A" ${s}/><path d="M60 76 V126" stroke="#4E8A41" stroke-width="3"/><circle cx="52" cy="92" r="3" fill="#F2C94C"/><circle cx="52" cy="106" r="3" fill="#F2C94C"/>`;
  } else {
    body = `<ellipse cx="60" cy="100" rx="38" ry="27" fill="${fur}" ${s}/>
<ellipse cx="42" cy="122" rx="11" ry="7" fill="${fur}" ${s}/><ellipse cx="78" cy="122" rx="11" ry="7" fill="${fur}" ${s}/>`;
  }

  let top = '';
  if (costume.suit === 'suit_banana' && !costume.hat) {
    top += `<path d="M50 20 L56 4 L66 8 L64 22Z" fill="#6B4A2B" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
  }
  if (costume.suit === 'suit_frog' && !costume.hat) {
    top += `<circle cx="42" cy="24" r="10" fill="#7BBF6A" ${s}/><circle cx="78" cy="24" r="10" fill="#7BBF6A" ${s}/><circle cx="42" cy="24" r="4" fill="${INK}"/><circle cx="78" cy="24" r="4" fill="${INK}"/>`;
  }
  if (costume.hat === 'hat_angry') {
    top += `<path d="M27 38 Q30 6 60 6 Q90 6 93 38Z" fill="#C0392B" ${s} stroke-linejoin="round"/>
<path d="M60 36 H110 Q108 46 60 44Z" fill="#9E2B20" ${s} stroke-linejoin="round"/>
<path d="M50 18 L56 24 M56 18 L50 24 M66 18 L72 24 M72 18 L66 24" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`;
  } else if (costume.hat === 'hat_party') {
    top += `<path d="M44 30 L62 -4 L78 30Z" fill="#7CC4F0" ${s} stroke-linejoin="round"/><path d="M50 18 L70 22 M54 8 L66 11" stroke="#F2C94C" stroke-width="4" stroke-linecap="round"/><circle cx="62" cy="-4" r="5" fill="#E85A8A" stroke="${INK}" stroke-width="2"/>`;
  }
  let glasses = '';
  if (costume.glasses === 'glasses_heart') {
    glasses = `<path d="${heart(46, 58)}" fill="#E85A8A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" opacity=".95"/><path d="${heart(74, 58)}" fill="#E85A8A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round" opacity=".95"/>
<path d="M56 56 Q60 52 64 56 M30 54 L34 56 M90 54 L86 56" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  }
  const zzz = mood === 'sleep' ? `<text x="96" y="20" font-size="18" fill="${INK}" font-family="Single Day, sans-serif">Z</text><text x="108" y="6" font-size="13" fill="${INK}" font-family="Single Day, sans-serif">z</text>` : '';

  const h = Math.round(size * 1.08);
  return `<svg viewBox="-6 -10 132 146" width="${size}" height="${h}" role="img" aria-label="${label}">${body}${head(species, fur)}${face(species, mood, fur)}${glasses}${top}${zzz}</svg>`;
}

export function avatar(pet, size = 44, mood = 'sad') {
  return `<span class="avatar" style="width:${size}px;height:${size}px">${petSVG(pet, { size: Math.round(size * 0.88), mood })}</span>`;
}
