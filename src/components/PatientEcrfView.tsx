import React, { useState } from 'react';
import { CheckCircle2, ClipboardCheck, PlusCircle, ShieldAlert, XCircle } from 'lucide-react';
import {
  BlindingMode,
  ConfounderCategory,
  InclusionExclusionChecklist,
  PatientRecord,
  UserRole,
} from '../types/clinical';
import { apiFetch } from '../utils/apiClient';

interface PatientEcrfViewProps {
  patient: PatientRecord;
  role: UserRole;
  onPatientUpdated: (updated: PatientRecord) => void;
  onPatientEnrolled: (created: PatientRecord) => void;
}

const CONFOUNDER_LABELS: Record<ConfounderCategory, string> = {
  opioid_analgesic: 'Opioid Analgesic',
  non_opioid_analgesic: 'Non-Opioid Analgesic',
  antispasmodic: 'Antispasmodic',
  prokinetic: 'Prokinetic Agent',
  antibiotic: 'Antibiotic Therapy',
  iv_fluid: 'IV Fluid Resuscitation',
  enteral_nutrition: 'Enteral Nutrition',
};

export const PatientEcrfView: React.FC<PatientEcrfViewProps> = ({
  patient,
  role,
  onPatientUpdated,
  onPatientEnrolled,
}) => {
  const isDataScientist = role === 'data_scientist';

  // Confounder Logger State
  const [cfCategory, setCfCategory] = useState<ConfounderCategory>('prokinetic');
  const [cfAgent, setCfAgent] = useState('Metoclopramide');
  const [cfDose, setCfDose] = useState('10 mg IV');
  const [cfHour, setCfHour] = useState<number>((patient.trend72h?.length ?? 12));
  const [cfNotes, setCfNotes] = useState('');
  const [savingCf, setSavingCf] = useState(false);

  // New Patient eCRF Enrollment Form State
  const [fullName, setFullName] = useState('');
  const [mrn, setMrn] = useState('');
  const [bedNumber, setBedNumber] = useState('ICU-09');
  const [centerCode, setCenterCode] = useState('CTR-01-HPB');
  const [age, setAge] = useState(52);
  const [sex, setSex] = useState<'M' | 'F'>('M');
  const [bmi, setBmi] = useState(27.4);
  const [etiology, setEtiology] = useState<PatientRecord['etiology']>('Biliary');
  const [hoursSinceOnset, setHoursSinceOnset] = useState(16);
  const [blindingMode, setBlindingMode] = useState<BlindingMode>('open_label');
  const [enrolling, setEnrolling] = useState(false);

  const [checklist, setChecklist] = useState<Omit<InclusionExclusionChecklist, 'eligible'>>({
    age18To85: true,
    verifiedApWithin48h: true,
    noPriorMajorAbdominalSurgery: true,
    notPregnant: true,
    noNeuromuscularDisease: true,
    noIbdOrIbs: true,
    noActiveOncology: true,
    noAdhesiveAllergy: true,
  });

  if (isDataScientist) {
    return (
      <section className="rounded-lg border border-slate-300 bg-slate-100 p-8 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-slate-700" />
        <h3 className="mt-3 text-base font-semibold text-slate-900">eCRF & PII Access Restricted</h3>
        <p className="mx-auto mt-1.5 max-w-xl text-sm text-slate-600">
          In accordance with HIPAA/GDPR PII segregation, Data Scientists cannot view or enroll identifiable patient eCRFs.
        </p>
      </section>
    );
  }

  const allEligible =
    checklist.age18To85 &&
    checklist.verifiedApWithin48h &&
    checklist.noPriorMajorAbdominalSurgery &&
    checklist.notPregnant &&
    checklist.noNeuromuscularDisease &&
    checklist.noIbdOrIbs &&
    checklist.noActiveOncology &&
    checklist.noAdhesiveAllergy &&
    age >= 18 &&
    age <= 85 &&
    hoursSinceOnset <= 48;

  const handleAddConfounder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cfAgent.trim() || !cfDose.trim()) return;
    setSavingCf(true);
    const res = await apiFetch(`/api/patients/${patient.studyId}/confounders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': role },
      body: JSON.stringify({
        category: cfCategory,
        agentName: cfAgent,
        doseOrVolume: cfDose,
        hourOffset: cfHour,
        notes: cfNotes,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      onPatientUpdated(data.patient);
      setCfNotes('');
    }
    setSavingCf(false);
  };

  const handleEnrollPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allEligible) return;
    setEnrolling(true);
    const res = await apiFetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': role },
      body: JSON.stringify({
        centerCode,
        pii: {
          fullName: fullName.trim() || 'De-identified Subject',
          mrn: mrn.trim() || `MRN-${Math.floor(100000 + Math.random() * 899999)}`,
          bedNumber,
        },
        age,
        sex,
        bmi,
        etiology,
        hoursSinceOnsetAtAdmission: hoursSinceOnset,
        blindingMode,
        checklist: { ...checklist, eligible: allEligible },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      onPatientEnrolled(data.patient);
      setFullName('');
      setMrn('');
    }
    setEnrolling(false);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Confounder & Medication Timeline */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-semibold text-slate-900">
              Therapy & Motility Confounder Timeline ({patient.studyId})
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Record analgesics, antispasmodics, prokinetics, antibiotics, IV fluids, and enteral nutrition timing
            </p>
          </div>

          <form onSubmit={handleAddConfounder} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <label className="block">
                <span className="text-slate-600">Confounder Category</span>
                <select
                  value={cfCategory}
                  onChange={(e) => setCfCategory(e.target.value as ConfounderCategory)}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  {Object.entries(CONFOUNDER_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-slate-600">Monitoring Hour Offset (T+h)</span>
                <input
                  type="number"
                  min={0}
                  max={168}
                  value={cfHour}
                  onChange={(e) => setCfHour(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>

              <label className="block">
                <span className="text-slate-600">Agent / Intervention</span>
                <input
                  type="text"
                  value={cfAgent}
                  onChange={(e) => setCfAgent(e.target.value)}
                  placeholder="e.g., Fentanyl, Erythromycin, Ringer's"
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  required
                />
              </label>

              <label className="block">
                <span className="text-slate-600">Dose / Infusion Rate / Volume</span>
                <input
                  type="text"
                  value={cfDose}
                  onChange={(e) => setCfDose(e.target.value)}
                  placeholder="e.g., 25 mcg/h IV or 250 mL/h"
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  required
                />
              </label>
            </div>

            <label className="block text-xs">
              <span className="text-slate-600">Clinical Context Notes</span>
              <input
                type="text"
                value={cfNotes}
                onChange={(e) => setCfNotes(e.target.value)}
                placeholder="Optional note on peristaltic response..."
                className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </label>

            <button
              type="submit"
              disabled={savingCf}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              {savingCf ? 'Logging...' : 'Log Therapy Confounder'}
            </button>
          </form>

          {/* Existing Confounders Table */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recorded Interventions ({(patient.confounders ?? []).length})
            </h4>
            <div className="mt-2 divide-y divide-slate-100">
              {(patient.confounders ?? []).map((cf) => (
                <div key={cf.id} className="flex items-start justify-between gap-3 py-2.5 text-xs">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {cf.agentName} <span className="font-normal text-slate-500">· {CONFOUNDER_LABELS[cf.category]}</span>
                    </div>
                    <div className="mt-0.5 text-slate-600">{cf.doseOrVolume}{cf.notes ? ` — ${cf.notes}` : ''}</div>
                  </div>
                  <span className="font-mono text-slate-500 tabular-nums shrink-0">T+{cf.hourOffset}h</span>
                </div>
              ))}
              {(patient.confounders ?? []).length === 0 && (
                <p className="py-4 text-xs text-slate-500">No confounders logged for this patient yet.</p>
              )}
            </div>
          </div>
        </section>

        {/* New Patient eCRF & Inclusion/Exclusion Checklist */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Enroll New Patient eCRF</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Auto-generates de-identified Study ID with segregated PII storage & protocol eligibility gate
              </p>
            </div>
            <ClipboardCheck className="h-4 w-4 text-blue-700" />
          </div>

          <form onSubmit={handleEnrollPatient} className="mt-4 space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold text-slate-700">Segregated PII Vault (Hospital Server Only)</div>
              <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-xs">
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Patient Full Name"
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                />
                <input
                  type="text"
                  value={mrn}
                  onChange={(e) => setMrn(e.target.value)}
                  placeholder="Hospital MRN"
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                />
                <input
                  type="text"
                  value={bedNumber}
                  onChange={(e) => setBedNumber(e.target.value)}
                  placeholder="Ward / Bed"
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-xs">
              <label className="block">
                <span className="text-slate-600">Age (18–85 yrs)</span>
                <input
                  type="number"
                  value={age}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setAge(val);
                    setChecklist((c) => ({ ...c, age18To85: val >= 18 && val <= 85 }));
                  }}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </label>

              <label className="block">
                <span className="text-slate-600">Sex</span>
                <select
                  value={sex}
                  onChange={(e) => setSex(e.target.value as 'M' | 'F')}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </label>

              <label className="block">
                <span className="text-slate-600">BMI (kg/m²)</span>
                <input
                  type="number"
                  step="0.1"
                  value={bmi}
                  onChange={(e) => setBmi(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </label>

              <label className="block">
                <span className="text-slate-600">AP Etiology</span>
                <select
                  value={etiology}
                  onChange={(e) => setEtiology(e.target.value as PatientRecord['etiology'])}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  <option value="Biliary">Biliary</option>
                  <option value="Alcoholic">Alcoholic</option>
                  <option value="Hypertriglyceridemic">Hypertriglyceridemic</option>
                  <option value="Post-ERCP">Post-ERCP</option>
                  <option value="Idiopathic">Idiopathic</option>
                </select>
              </label>

              <label className="block">
                <span className="text-slate-600">Onset-to-Enroll (h)</span>
                <input
                  type="number"
                  value={hoursSinceOnset}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setHoursSinceOnset(val);
                    setChecklist((c) => ({ ...c, verifiedApWithin48h: val <= 48 }));
                  }}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </label>

              <label className="block">
                <span className="text-slate-600">Study Center</span>
                <select
                  value={centerCode}
                  onChange={(e) => setCenterCode(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                >
                  <option value="CTR-01-HPB">CTR-01-HPB</option>
                  <option value="CTR-02-SURG">CTR-02-SURG</option>
                  <option value="CTR-03-GASTRO">CTR-03-GASTRO</option>
                </select>
              </label>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">Automated Inclusion / Exclusion Checklist</span>
                <span className={`inline-flex items-center gap-1 font-semibold ${allEligible ? 'text-emerald-700' : 'text-red-700'}`}>
                  {allEligible ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {allEligible ? 'Eligible for Enrollment' : 'Exclusion Triggered'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-xs">
                {[
                  { key: 'age18To85', label: 'Age 18–85 years verified' },
                  { key: 'verifiedApWithin48h', label: 'Verified AP within 48h of onset' },
                  { key: 'noPriorMajorAbdominalSurgery', label: 'No prior major abdominal surgery' },
                  { key: 'notPregnant', label: 'Not pregnant' },
                  { key: 'noNeuromuscularDisease', label: 'No neuromuscular disease' },
                  { key: 'noIbdOrIbs', label: 'No IBD or IBS history' },
                  { key: 'noActiveOncology', label: 'No active GI oncology' },
                  { key: 'noAdhesiveAllergy', label: 'No adhesive patch allergy' },
                ].map((item) => (
                  <label key={item.key} className="flex items-center gap-2 rounded border border-slate-200 px-2.5 py-1.5 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checklist[item.key as keyof typeof checklist]}
                      onChange={(e) =>
                        setChecklist((prev) => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-blue-700"
                    />
                    <span className="text-slate-700">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <select
                value={blindingMode}
                onChange={(e) => setBlindingMode(e.target.value as BlindingMode)}
                className="rounded border border-slate-300 bg-white px-2.5 py-2 text-xs"
              >
                <option value="open_label">Open-Label Clinical Mode</option>
                <option value="double_blind">Double-Blind Research Mode</option>
              </select>

              <button
                type="submit"
                disabled={!allEligible || enrolling}
                className="flex-1 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {enrolling ? 'Creating eCRF...' : 'Enroll Patient & Generate Study ID'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
};
