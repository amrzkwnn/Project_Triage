// ---------------------------------------------------------------------------
// Triage seed data — DUMMY DATA ONLY. No real patient information anywhere.
// All dates are computed relative to "today" so the demo always looks live.
// ---------------------------------------------------------------------------

const today = new Date();
today.setHours(0, 0, 0, 0);

export const dayOffset = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d;
};

export const fmtTime = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const fmtDate = (d, opts) =>
  d.toLocaleDateString('en-US', opts ?? { weekday: 'long', month: 'long', day: 'numeric' });

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const people = {
  me: { id: 'me', name: 'Dr. Daniel Chen', short: 'Me', relation: 'self', avatar: 'teal' },
  wife: { id: 'wife', name: 'Maya Chen', short: 'Wife', relation: 'wife', avatar: 'violet' },
  child1: { id: 'child1', name: 'Lily Chen', short: 'Child 1', relation: 'child', avatar: 'blue' },
  child2: { id: 'child2', name: 'Noah Chen', short: 'Child 2', relation: 'child', avatar: 'amber' },
  pt1: { id: 'pt1', name: 'Grace Okafor', short: 'Grace O.', relation: 'patient', avatar: 'slate' },
  pt2: { id: 'pt2', name: 'Marcus Webb', short: 'Marcus W.', relation: 'patient', avatar: 'slate' },
  pt3: { id: 'pt3', name: 'Eleanor Vargas', short: 'Eleanor V.', relation: 'patient', avatar: 'slate' },
};
export const peopleList = Object.values(people);
export const personById = (id) => people[id];

// Approved avatar tint set (teal / violet / blue / amber / slate).
export const avatarStyles = {
  teal: 'bg-teal-100 text-teal-800',
  violet: 'bg-violet-100 text-violet-700',
  blue: 'bg-blue-100 text-blue-700',
  amber: 'bg-amber-100 text-amber-800',
  slate: 'bg-slate-100 text-slate-600',
};

// ---------------------------------------------------------------------------
// Appointments — day 0 = today, at = minutes from midnight
// ---------------------------------------------------------------------------

export const appointments = [
  // Today
  { id: 'ap1', day: 0, at: 480, title: 'Ward rounds — Grace Okafor', personId: 'pt1', category: 'work', location: 'Mercy General · Ward 4' },
  { id: 'ap2', day: 0, at: 570, title: 'Telehealth follow-up', personId: 'pt2', category: 'work', location: 'Video call · Mercy General' },
  { id: 'ap3', day: 0, at: 660, title: 'Cardiology check-up', personId: 'wife', category: 'personal', location: 'Lakeview Heart Center' },
  { id: 'ap4', day: 0, at: 780, title: 'Post-op clinic review', personId: 'pt3', category: 'work', location: 'Mercy General · Clinic 2B' },
  { id: 'ap5', day: 0, at: 960, title: 'Dentist appointment', personId: 'child1', category: 'personal', location: 'Bright Smiles Pediatric Dental' },
  { id: 'ap6', day: 0, at: 1050, title: 'Flu shot', personId: 'child2', category: 'personal', location: 'Westside Pediatrics' },
  // This week
  { id: 'ap7', day: 1, at: 540, title: 'Cardiology staff meeting', personId: 'me', category: 'work', location: 'Mercy General · Conf. Rm 3' },
  { id: 'ap8', day: 1, at: 840, title: 'Dermatology consult', personId: 'wife', category: 'personal', location: 'Northside Skin Clinic' },
  { id: 'ap9', day: 2, at: 600, title: 'Hypertension clinic block', personId: 'me', category: 'work', location: 'Mercy General · Clinic 2B' },
  { id: 'ap10', day: 2, at: 930, title: 'Pediatric follow-up', personId: 'child2', category: 'personal', location: 'Westside Pediatrics' },
  { id: 'ap11', day: 3, at: 660, title: 'Lab results review — Grace Okafor', personId: 'pt1', category: 'work', location: 'Video call · Mercy General' },
  { id: 'ap12', day: 3, at: 780, title: 'Science fair presentation', personId: 'child1', category: 'personal', location: 'Lakeside Elementary' },
  { id: 'ap13', day: 4, at: 570, title: 'Insulin review — Marcus Webb', personId: 'pt2', category: 'work', location: 'Video call · Mercy General' },
];

// ---------------------------------------------------------------------------
// Urgent tasks ("Needs action now")
// ---------------------------------------------------------------------------

export const tasks = [
  {
    id: 't1',
    title: 'Critical lab result',
    category: 'work',
    personId: 'pt1',
    due: 'Sign off by 10:00 AM',
    note: "Grace Okafor's potassium is 6.2, above the normal range.",
  },
  {
    id: 't2',
    title: 'Prescription renewal',
    category: 'work',
    personId: 'pt2',
    due: 'Expires today',
    note: 'Marcus Webb · Lisinopril 10 mg, 2 refills.',
  },
  {
    id: 't3',
    title: 'School medical form',
    category: 'personal',
    personId: 'child2',
    due: 'Due by 3:00 PM',
    note: "Noah's allergy action plan for the school nurse.",
  },
];

// ---------------------------------------------------------------------------
// Records (prescriptions + lab reports)
// details: { label, value, unit, range, abnormal?, direction? }
// ---------------------------------------------------------------------------

export const records = [
  {
    id: 'rec1',
    type: 'lab',
    personId: 'pt1',
    category: 'work',
    source: 'whatsapp',
    date: dayOffset(-1),
    title: 'Comprehensive Metabolic Panel',
    summary:
      'Potassium is critically high at 6.2 mmol/L (normal 3.5–5.1); every other value is within range. Needs urgent review — consider a repeat draw and a patient callback this morning.',
    details: [
      { label: 'Sodium', value: '138', unit: 'mmol/L', range: '135–145' },
      { label: 'Potassium', value: '6.2', unit: 'mmol/L', range: '3.5–5.1', abnormal: true, direction: 'high' },
      { label: 'Chloride', value: '103', unit: 'mmol/L', range: '98–107' },
      { label: 'CO₂ (bicarbonate)', value: '25', unit: 'mmol/L', range: '22–29' },
      { label: 'Creatinine', value: '1.1', unit: 'mg/dL', range: '0.6–1.2' },
      { label: 'eGFR', value: '74', unit: 'mL/min/1.73m²', range: '> 60' },
    ],
  },
  {
    id: 'rec2',
    type: 'rx',
    personId: 'pt2',
    category: 'work',
    source: 'email',
    date: dayOffset(-2),
    title: 'Lisinopril renewal request',
    summary:
      'Pharmacy renewal request: Lisinopril 10 mg and metoprolol succinate 25 mg, both once daily. Continue current doses; 2 refills authorized.',
    details: [
      { label: 'Lisinopril', value: '10 mg', unit: 'tablet', range: 'Once daily · 30 tablets · 2 refills' },
      { label: 'Metoprolol succinate', value: '25 mg', unit: 'tablet', range: 'Once daily · 30 tablets' },
    ],
  },
  {
    id: 'rec3',
    type: 'lab',
    personId: 'wife',
    category: 'personal',
    source: 'whatsapp',
    date: dayOffset(-3),
    title: 'Lipid Panel',
    summary:
      'LDL cholesterol is elevated at 148 mg/dL (goal under 100), pushing total cholesterol slightly over the line. HDL and triglycerides look good. Worth discussing diet and possible statin therapy at the cardiology visit.',
    details: [
      { label: 'Total cholesterol', value: '221', unit: 'mg/dL', range: '< 200', abnormal: true, direction: 'high' },
      { label: 'LDL cholesterol', value: '148', unit: 'mg/dL', range: '< 100', abnormal: true, direction: 'high' },
      { label: 'HDL cholesterol', value: '62', unit: 'mg/dL', range: '> 59' },
      { label: 'Triglycerides', value: '128', unit: 'mg/dL', range: '< 150' },
    ],
  },
  {
    id: 'rec4',
    type: 'rx',
    personId: 'child1',
    category: 'personal',
    source: 'sms',
    date: dayOffset(-5),
    title: 'Amoxicillin suspension',
    summary:
      'Ear infection course for Lily: amoxicillin 250 mg/5 mL, 5 mL twice daily for 7 days. Finish the full course even if she feels better after day 3.',
    details: [
      { label: 'Amoxicillin suspension', value: '250 mg/5 mL', unit: '', range: '5 mL twice daily · 7 days · dispense 100 mL' },
    ],
  },
  {
    id: 'rec5',
    type: 'lab',
    personId: 'me',
    category: 'personal',
    source: 'upload',
    date: dayOffset(-8),
    title: 'HbA1c & Metabolic Panel',
    summary:
      'HbA1c is 6.1% — in the pre-diabetes range (normal under 5.7). Fasting glucose and kidney values are fine. A repeat A1c in 3 months would confirm the trend.',
    details: [
      { label: 'HbA1c', value: '6.1', unit: '%', range: '< 5.7', abnormal: true, direction: 'high' },
      { label: 'Fasting glucose', value: '99', unit: 'mg/dL', range: '70–99' },
      { label: 'Creatinine', value: '0.9', unit: 'mg/dL', range: '0.6–1.2' },
      { label: 'eGFR', value: '92', unit: 'mL/min/1.73m²', range: '> 60' },
    ],
  },
  {
    id: 'rec6',
    type: 'rx',
    personId: 'child2',
    category: 'personal',
    source: 'whatsapp',
    date: dayOffset(-10),
    title: 'Albuterol HFA inhaler',
    summary:
      'Rescue inhaler for Noah: albuterol HFA 90 mcg per actuation, two puffs every 4–6 hours as needed for wheezing. Check technique at the pediatric follow-up.',
    details: [
      { label: 'Albuterol HFA', value: '90 mcg', unit: 'actuation', range: '2 puffs every 4–6 h as needed · 1 inhaler' },
    ],
  },
  {
    id: 'rec7',
    type: 'lab',
    personId: 'pt3',
    category: 'work',
    source: 'email',
    date: dayOffset(-12),
    title: 'Complete Blood Count (post-op)',
    summary:
      'Post-operative CBC for Eleanor Vargas is entirely normal — white count, hemoglobin and platelets all within reference ranges. No signs of infection or anemia.',
    details: [
      { label: 'White blood cells', value: '7.2', unit: 'K/µL', range: '4.0–11.0' },
      { label: 'Hemoglobin', value: '13.5', unit: 'g/dL', range: '12.0–15.5' },
      { label: 'Platelets', value: '250', unit: 'K/µL', range: '150–400' },
    ],
  },
];

// The simulated upload result — a realistic lab report with one abnormal value.
// Not part of the default Records list; the upload flow routes straight to it.
export const uploadResultRecord = {
  id: 'rec-uploaded',
  type: 'lab',
  personId: 'me',
  category: 'personal',
  source: 'upload',
  date: new Date(),
  title: 'Comprehensive Metabolic Panel',
  summary:
    'Fasting glucose is mildly elevated at 118 mg/dL (normal 70–99); every other value is normal. Compare with your last HbA1c of 6.1% — a repeat fasting panel in 2 weeks would help confirm the trend.',
  details: [
    { label: 'Glucose (fasting)', value: '118', unit: 'mg/dL', range: '70–99', abnormal: true, direction: 'high' },
    { label: 'Sodium', value: '139', unit: 'mmol/L', range: '135–145' },
    { label: 'Potassium', value: '4.4', unit: 'mmol/L', range: '3.5–5.1' },
    { label: 'Creatinine', value: '1.0', unit: 'mg/dL', range: '0.6–1.2' },
    { label: 'eGFR', value: '88', unit: 'mL/min/1.73m²', range: '> 60' },
  ],
};

export const recordById = (id) =>
  id === uploadResultRecord.id
    ? uploadResultRecord
    : records.find((r) => r.id === id);

// ---------------------------------------------------------------------------
// Session records — records "created" during this demo run (e.g. the
// simulated upload result). Records list picks these up on its next mount.
// ---------------------------------------------------------------------------
export const sessionRecords = [];

export function addSessionRecord(record) {
  if (!sessionRecords.some((r) => r.id === record.id)) sessionRecords.push(record);
}

export function resetSessionRecords() {
  sessionRecords.length = 0;
}

// ---------------------------------------------------------------------------
// Source badge metadata
// ---------------------------------------------------------------------------

export const sourceMeta = {
  whatsapp: { label: 'WhatsApp', classes: 'bg-green-50 text-green-700' },
  email: { label: 'Email', classes: 'bg-blue-50 text-blue-700' },
  sms: { label: 'SMS', classes: 'bg-slate-100 text-slate-600' },
  upload: { label: 'Upload', classes: 'bg-teal-50 text-teal-700' },
};

export const categoryMeta = {
  work: { label: 'Work', classes: 'bg-teal-50 text-teal-800 border-teal-100' },
  personal: { label: 'Personal', classes: 'bg-violet-100 text-violet-700 border-violet-100' },
};
