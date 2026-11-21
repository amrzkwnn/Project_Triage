// ---------------------------------------------------------------------------
// Inline SVG document images — no external image links anywhere.
// Two variants:
//   'original'  — warm paper tint, slight tilt, scanline noise (the screenshot)
//   'enhanced'  — crisp white, aligned table, teal accents (the cleaned-up view)
// ---------------------------------------------------------------------------

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtDocDate = (d) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const SCANLINES = `
  <defs>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="1.5" fill="rgba(60,50,30,0.05)"/>
    </pattern>
  </defs>`;

function labDoc(record, personName, variant) {
  const enhanced = variant === 'enhanced';
  const bg = enhanced ? '#FFFFFF' : '#F5F2E8';
  const text = enhanced ? '#0F172A' : '#40392C';
  const soft = enhanced ? '#64748B' : '#7A7060';
  const accent = enhanced ? '#0F766E' : '#5B5443';
  const tilt = enhanced ? '' : ' transform="rotate(-0.5 160 200)"';
  const rowText = enhanced ? '#334155' : '#4A4436';
  const rows = record.details
    .map((d, i) => {
      const y = 128 + i * 27;
      const flag = d.abnormal
        ? `<circle cx="292" cy="${y - 3}" r="8" fill="#FEE2E2"/><text x="292" y="${y}" text-anchor="middle" font-size="9" font-weight="700" fill="#DC2626">${d.direction === 'low' ? 'L' : 'H'}</text>`
        : '';
      const valueColor = d.abnormal ? '#DC2626' : text;
      return `
      <line x1="16" y1="${y + 9}" x2="304" y2="${y + 9}" stroke="${enhanced ? '#EEF1F5' : '#DDD5C2'}" stroke-width="1"/>
      <text x="16" y="${y}" font-size="10" fill="${rowText}">${esc(d.label)}</text>
      <text x="210" y="${y}" font-size="10.5" font-weight="700" fill="${valueColor}" text-anchor="end">${esc(d.value)}${d.unit ? ' ' + esc(d.unit) : ''}</text>
      <text x="218" y="${y}" font-size="8.5" fill="${soft}">${d.range ? 'Ref ' + esc(d.range) : esc(d.range || '')}</text>
      ${flag}`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 420" width="320" height="420">
  ${enhanced ? '' : SCANLINES}
  <g${tilt}>
    <rect width="320" height="420" rx="10" fill="${bg}" stroke="${enhanced ? '#CCFBF1' : '#D8CFB8'}" stroke-width="1.5"/>
    ${enhanced ? '' : '<rect width="320" height="420" rx="10" fill="url(#scan)"/>'}
    <rect x="0" y="0" width="320" height="64" rx="10" fill="${enhanced ? '#F0FDFA' : '#EDE7D6'}"/>
    <rect x="0" y="56" width="320" height="8" fill="${enhanced ? '#F0FDFA' : '#EDE7D6'}"/>
    <text x="18" y="24" font-size="9" font-weight="700" letter-spacing="1.4" fill="${accent}">MERCY GENERAL HEALTH SYSTEM</text>
    <text x="18" y="44" font-size="13" font-weight="700" fill="${text}">Laboratory Report</text>
    <text x="302" y="24" font-size="8" fill="${soft}" text-anchor="end">CLIA-33D2119874</text>

    <text x="18" y="88" font-size="8.5" letter-spacing="0.8" fill="${soft}">PATIENT</text>
    <text x="18" y="102" font-size="11" font-weight="600" fill="${text}">${esc(personName)}</text>
    <text x="302" y="88" font-size="8.5" letter-spacing="0.8" fill="${soft}" text-anchor="end">COLLECTED</text>
    <text x="302" y="102" font-size="11" font-weight="600" fill="${text}" text-anchor="end">${fmtDocDate(record.date)}</text>
    <line x1="16" y1="114" x2="304" y2="114" stroke="${enhanced ? '#0F766E' : '#B9AF97'}" stroke-width="1.5"/>
    ${rows}

    <text x="18" y="396" font-size="7.5" fill="${soft}">Verified by Mercy General Laboratory · Results preliminary until reviewed by ordering provider</text>
  </g>
</svg>`;
}

function rxBlob(record, personName, variant) {
  const enhanced = variant === 'enhanced';
  const bg = enhanced ? '#FFFFFF' : '#F5F2E8';
  const text = enhanced ? '#0F172A' : '#40392C';
  const soft = enhanced ? '#64748B' : '#7A7060';
  const accent = enhanced ? '#0F766E' : '#5B5443';
  const tilt = enhanced ? '' : ' transform="rotate(0.6 160 200)"';
  const meds = record.details
    .map((m, i) => {
      const y = 150 + i * 64;
      return `
      <text x="18" y="${y}" font-size="12.5" font-weight="700" fill="${text}">${esc(m.label)} ${esc(m.value)}</text>
      <text x="18" y="${y + 17}" font-size="10" fill="${soft}">${esc(m.range || '')}</text>
      ${i < record.details.length - 1 ? `<line x1="18" y1="${y + 36}" x2="302" y2="${y + 36}" stroke="${enhanced ? '#EEF1F5' : '#DDD5C2'}" stroke-width="1"/>` : ''}`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 420" width="320" height="420">
  ${enhanced ? '' : SCANLINES}
  <g${tilt}>
    <rect width="320" height="420" rx="10" fill="${bg}" stroke="${enhanced ? '#CCFBF1' : '#D8CFB8'}" stroke-width="1.5"/>
    ${enhanced ? '' : '<rect width="320" height="420" rx="10" fill="url(#scan)"/>'}
    <rect x="0" y="0" width="320" height="70" rx="10" fill="${enhanced ? '#F0FDFA' : '#EDE7D6'}"/>
    <rect x="0" y="62" width="320" height="8" fill="${enhanced ? '#F0FDFA' : '#EDE7D6'}"/>
    <text x="18" y="24" font-size="9" font-weight="700" letter-spacing="1.4" fill="${accent}">MERCY GENERAL · INTERNAL MEDICINE</text>
    <text x="18" y="52" font-size="20" font-weight="700" font-style="italic" fill="${accent}">Rx</text>

    <text x="18" y="100" font-size="8.5" letter-spacing="0.8" fill="${soft}">PATIENT</text>
    <text x="18" y="114" font-size="11" font-weight="600" fill="${text}">${esc(personName)}</text>
    <text x="302" y="100" font-size="8.5" letter-spacing="0.8" fill="${soft}" text-anchor="end">DATE</text>
    <text x="302" y="114" font-size="11" font-weight="600" fill="${text}" text-anchor="end">${fmtDocDate(record.date)}</text>
    <line x1="16" y1="126" x2="304" y2="126" stroke="${enhanced ? '#0F766E' : '#B9AF97'}" stroke-width="1.5"/>
    <line x1="18" y1="132" x2="302" y2="132" stroke="${enhanced ? '#0F766E' : '#B9AF97'}" stroke-width="1"/>
    ${meds}

    <line x1="160" y1="374" x2="302" y2="374" stroke="${soft}" stroke-width="1"/>
    <text x="302" y="388" font-size="9" font-weight="600" fill="${text}" text-anchor="end">Daniel Chen, MD</text>
    <text x="302" y="400" font-size="7.5" fill="${soft}" text-anchor="end">DEA BC1234567 · NPI 1730XXXXXX</text>
  </g>
</svg>`;
}

/**
 * Returns an inline SVG string for a record's document image.
 * documentSvg(record, personName, variant = 'enhanced')
 */
export function documentSvg(record, personName, variant = 'enhanced') {
  return record.type === 'rx' ? rxBlob(record, personName, variant) : labDoc(record, personName, variant);
}

/** The pre-made sample screenshot used by the demo's auto-upload step. */
export const sampleUploadSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 420" width="320" height="420">
  <defs><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.5" fill="rgba(60,50,30,0.05)"/></pattern></defs>
  <g transform="rotate(-0.8 160 200)">
    <rect width="320" height="420" rx="10" fill="#F5F2E8" stroke="#D8CFB8" stroke-width="1.5"/>
    <rect width="320" height="420" rx="10" fill="url(#scan)"/>
    <rect x="0" y="0" width="320" height="64" rx="10" fill="#EDE7D6"/>
    <rect x="0" y="56" width="320" height="8" fill="#EDE7D6"/>
    <text x="18" y="24" font-size="9" font-weight="700" letter-spacing="1.4" fill="#5B5443">MERCY GENERAL HEALTH SYSTEM</text>
    <text x="18" y="44" font-size="13" font-weight="700" fill="#40392C">Lab Report — CMP</text>
    <text x="18" y="96" font-size="8.5" letter-spacing="0.8" fill="#7A7060">PATIENT</text>
    <text x="18" y="110" font-size="11" font-weight="600" fill="#40392C">Daniel Chen</text>
    <line x1="16" y1="126" x2="304" y2="126" stroke="#B9AF97" stroke-width="1.5"/>
    ${[
      ['Glucose (fasting)', '118 mg/dL', 'H'],
      ['Sodium', '139 mmol/L', ''],
      ['Potassium', '4.4 mmol/L', ''],
      ['Creatinine', '1.0 mg/dL', ''],
      ['eGFR', '88 mL/min', ''],
    ]
      .map(
        ([l, v, f], i) => {
          const y = 150 + i * 27;
          return `<line x1="16" y1="${y + 9}" x2="304" y2="${y + 9}" stroke="#DDD5C2" stroke-width="1"/>
      <text x="16" y="${y}" font-size="10" fill="#4A4436">${l}</text>
      <text x="240" y="${y}" font-size="10.5" font-weight="700" fill="#40392C" text-anchor="end">${v}</text>
      ${f ? `<circle cx="262" cy="${y - 3}" r="8" fill="#F3D9D9"/><text x="262" y="${y}" text-anchor="middle" font-size="9" font-weight="700" fill="#A03030">${f}</text>` : ''}`;
        }
      )
      .join('')}
    <text x="18" y="400" font-size="7.5" fill="#7A7060">Photo of printed report · received via WhatsApp</text>
  </g>
</svg>`;
