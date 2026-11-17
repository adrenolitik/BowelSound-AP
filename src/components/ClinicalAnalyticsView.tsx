import React, { useState } from 'react';
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  Download,
  FileJson,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { DayScaleRecord, LabMarkers, PatientRecord, UserRole } from '../types/clinical';
import {
  computeApacheIiScore,
  computeBisapScore,
  computeModifiedMarshallScore,
  computeRansonScore,
} from '../utils/clinicalScoring';
import { apiFetch } from '../utils/apiClient';

interface ClinicalAnalyticsViewProps {
  patient: PatientRecord;
  role: UserRole;
  onPatientUpdated: (updated: PatientRecord) => void;
}

const SAMPLE_FHIR_BUNDLE = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    { resource: { resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '1798-8', display: 'Amylase' }] }, valueQuantity: { value: 640, unit: 'U/L' } } },
    { resource: { resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '3040-3', display: 'Lipase' }] }, valueQuantity: { value: 1120, unit: 'U/L' } } },
    { resource: { resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'C-Reactive Protein' }] }, valueQuantity: { value: 148, unit: 'mg/L' } } },
    { resource: { resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '6690-2', display: 'WBC' }] }, valueQuantity: { value: 15.8, unit: '10^9/L' } } },
    { resource: { resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '4544-3', display: 'Hematocrit' }] }, valueQuantity: { value: 39.2, unit: '%' } } },
    { resource: { resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine' }] }, valueQuantity: { value: 1.4, unit: 'mg/dL' } } },
    { resource: { resourceType: 'Observation', code: { coding: [{ system: 'http://loinc.org', code: '3094-0', display: 'BUN' }] }, valueQuantity: { value: 23, unit: 'mg/dL' } } },
  ],
};

export const ClinicalAnalyticsView: React.FC<ClinicalAnalyticsViewProps> = ({
  patient,
  role,
  onPatientUpdated,
}) => {
  const scales = patient.dayScales ?? [];
  const latest = scales[scales.length - 1];
  const prognosis = patient.prognosis;

  const isDataScientistBlinded = role === 'data_scientist' && patient.blindingMode === 'double_blind';
  const isClinicianBlinded = role === 'clinician' && patient.blindingMode === 'double_blind';

  const [selectedDay, setSelectedDay] = useState<0 | 1 | 2 | 7>(7);
  const [agiGrade, setAgiGrade] = useState<0 | 1 | 2 | 3 | 4>(latest?.agiGrade ?? 1);
  const [labsForm, setLabsForm] = useState<LabMarkers>(
    latest?.labs ?? {
      amylaseUL: 850,
      lipaseUL: 1500,
      crpMgL: 120,
      wbc10e9L: 14.5,
      hematocritPct: 40,
      creatinineMgDl: 1.3,
      bunMgDl: 21,
      lactateMmolL: 1.9,
      pao2Fio2: 320,
      arterialPh: 7.36,
      sbpMmHg: 112,
      ldhUL: 340,
      astUL: 160,
      glucoseMgDl: 165,
      calciumMgDl: 8.4,
      baseDeficitMeqL: 2.5,
      heartRateBpm: 98,
      respRateBpm: 20,
      tempC: 37.9,
      sodiumMeqL: 139,
      potassiumMeqL: 4.1,
      gcs: 15,
      pleuralEffusion: false,
      impairedMentalStatus: false,
    }
  );
  const [savingScale, setSavingScale] = useState(false);
  const [fhirJson, setFhirJson] = useState(JSON.stringify(SAMPLE_FHIR_BUNDLE, null, 2));
  const [fhirStatus, setFhirStatus] = useState<string | null>(null);

  if (isDataScientistBlinded) {
    return (
      <section className="rounded-lg border border-slate-300 bg-slate-100 p-8 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-slate-700" />
        <h3 className="mt-3 text-base font-semibold text-slate-900">Clinical Chart & Outcomes Blinded</h3>
        <p className="mx-auto mt-1.5 max-w-xl text-sm text-slate-600">
          {patient.blindedRedactionNotice} Switch to Research & Annotation to inspect de-identified spectrograms and feature matrices.
        </p>
      </section>
    );
  }

  const previewRanson = computeRansonScore(patient.age, labsForm, selectedDay >= 2);
  const previewApache = computeApacheIiScore(patient.age, labsForm);
  const previewBisap = computeBisapScore(patient.age, labsForm);
  const previewMarshall = computeModifiedMarshallScore(labsForm);

  const handleSaveScaleDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingScale(true);
    const res = await apiFetch(`/api/patients/${patient.studyId}/scales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': role },
      body: JSON.stringify({ day: selectedDay, labs: labsForm, agiGrade }),
    });
    if (res.ok) {
      const data = await res.json();
      onPatientUpdated(data.patient);
    }
    setSavingScale(false);
  };

  const handleFhirImport = async () => {
    setFhirStatus(null);
    try {
      const parsed = JSON.parse(fhirJson);
      const res = await apiFetch('/api/fhir/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify({ studyId: patient.studyId, bundle: parsed }),
      });
      if (res.ok) {
        const data = await res.json();
        onPatientUpdated(data.patient);
        setFhirStatus(`Imported ${data.importedCount} HL7 FHIR LOINC observations and updated clinical scores.`);
      } else {
        const err = await res.json();
        setFhirStatus(err.error ?? 'FHIR import failed');
      }
    } catch {
      setFhirStatus('Invalid JSON syntax in HL7 FHIR Bundle.');
    }
  };

  const handleExportFhirReport = async () => {
    const res = await apiFetch(`/api/fhir/DiagnosticReport/${patient.studyId}`, {
      headers: { 'x-user-role': role },
    });
    if (res.ok) {
      const report = await res.json();
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${patient.studyId}_FHIR_DiagnosticReport.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const trafficLightStyles = {
    ileus: {
      border: 'border-red-300',
      bg: 'bg-red-50',
      text: 'text-red-900',
      label: 'Red · Ileus / High Intolerance Risk',
    },
    transitional: {
      border: 'border-amber-300',
      bg: 'bg-amber-50',
      text: 'text-amber-900',
      label: 'Amber · Transitional Motility Zone',
    },
    recovery: {
      border: 'border-emerald-300',
      bg: 'bg-emerald-50',
      text: 'text-emerald-900',
      label: 'Green · Motility Recovery / EN Start or Advance Recommended',
    },
  };

  return (
    <div className="space-y-6">
      {/* Critical 2-Hour Silent Abdomen Alert */}
      {prognosis?.silentAbdomenAlert && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3.5 text-sm text-red-950">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <div className="font-semibold">
              Clinical Alert: Silent Abdomen ("Dead Silence" / Progressive Ileus) Sustained for {prognosis.silentAbdomenHours} Consecutive Hours
            </div>
            <p className="mt-0.5 text-red-800">
              Acoustic occurrence rate remained below 0.8 events/min across ≥2 consecutive valid monitoring hours. Evaluate for abdominal compartment pressure, opioid toxicity, or infected pancreatic necrosis.
            </p>
          </div>
        </div>
      )}

      {/* Prognostic Outcome Panel */}
      {isClinicianBlinded || !prognosis ? (
        <section className="rounded-lg border border-slate-300 bg-slate-100 p-6 text-center text-sm text-slate-700">
          Acoustic & Multimodal Outcome Predictions are withheld under Double-Blind Protocol. Clinical severity calculators remain accessible below.
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Primary SAP Risk Comparison */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  7-Day Severe Acute Pancreatitis (SAP) Risk Stratification
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Revised Atlanta persistent organ failure (&gt;48h) probability with 95% confidence interval
                </p>
              </div>
              <TrendingUp className="h-4 w-4 text-blue-700" />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-md border border-blue-200 bg-blue-50/50 p-4">
                <div className="text-xs font-medium text-blue-900">Combined Clinico-Acoustic</div>
                <div className="mt-1.5 font-mono text-3xl font-bold text-blue-950 tabular-nums">
                  {prognosis.combinedSapProbPct}%
                </div>
                <div className="mt-1 font-mono text-xs text-blue-800 tabular-nums">
                  95% CI: {prognosis.combinedCi95[0]}% – {prognosis.combinedCi95[1]}%
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-medium text-slate-700">Autonomous BS-only Model</div>
                <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {prognosis.bsOnlySapProbPct}%
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
                  95% CI: {prognosis.bsOnlyCi95[0]}% – {prognosis.bsOnlyCi95[1]}%
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-medium text-slate-700">Clinical Scales Alone</div>
                <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {prognosis.clinicalScalesSapProbPct}%
                </div>
                <div className="mt-1 text-xs text-slate-500">Marshall + APACHE II + BISAP</div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
              <div>
                <div className="text-xs text-slate-500">Predicted Hospital LOS</div>
                <div className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                  {prognosis.predictedLosDays} days
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Infected Necrosis / Sepsis Risk</div>
                <div className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                  {prognosis.infectedNecrosisSepsisRiskPct}%
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">90-Day Mortality Risk</div>
                <div className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                  {prognosis.mortality90DayRiskPct}%
                </div>
              </div>
            </div>
          </div>

          {/* Enteral Nutrition Traffic Light & Motility Recovery Index */}
          <div className={`rounded-lg border p-5 ${trafficLightStyles[prognosis.enteralZone].border} ${trafficLightStyles[prognosis.enteralZone].bg}`}>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-600">
              Enteral Nutrition Tolerance
            </div>
            <div className={`mt-1.5 text-base font-bold ${trafficLightStyles[prognosis.enteralZone].text}`}>
              {trafficLightStyles[prognosis.enteralZone].label}
            </div>

            <div className="mt-4 rounded-md border border-white/80 bg-white/80 p-3">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Motility Recovery Index</span>
                <span className="font-mono text-base font-bold text-slate-900 tabular-nums">
                  {prognosis.motilityRecoveryIndex} / 100
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full transition-all ${
                    prognosis.enteralZone === 'recovery'
                      ? 'bg-emerald-600'
                      : prognosis.enteralZone === 'transitional'
                      ? 'bg-amber-500'
                      : 'bg-red-600'
                  }`}
                  style={{ width: `${prognosis.motilityRecoveryIndex}%` }}
                />
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-800">{prognosis.enteralRecommendation}</p>
          </div>
        </section>
      )}

      {/* Longitudinal Severity Scales Table (Day 0, Day 1, Day 2, Day 7) */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Dynamic Severity Scales & Laboratory Trajectory (Day 0 – Day 7)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Automated Ranson, APACHE II, BISAP, Modified Marshall, and AGI grading across hospitalization milestones
            </p>
          </div>
          {patient.fhirImportedAt && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" /> FHIR Synced {new Date(patient.fhirImportedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-4 font-medium">Hospital Day</th>
                <th className="py-2 px-3 font-medium text-right">Ranson</th>
                <th className="py-2 px-3 font-medium text-right">APACHE II</th>
                <th className="py-2 px-3 font-medium text-right">BISAP</th>
                <th className="py-2 px-3 font-medium text-right">Mod. Marshall</th>
                <th className="py-2 px-3 font-medium text-right">AGI Grade</th>
                <th className="py-2 px-3 font-medium text-right">CRP (mg/L)</th>
                <th className="py-2 px-3 font-medium text-right">Lipase (U/L)</th>
                <th className="py-2 px-3 font-medium text-right">Hct (%)</th>
                <th className="py-2 pl-3 font-medium text-right">Creatinine</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
              {scales.map((d: DayScaleRecord) => (
                <tr key={d.day} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-4 font-sans font-semibold text-slate-900">Day {d.day}</td>
                  <td className="py-2.5 px-3 text-right">{d.ransonScore}</td>
                  <td className={`py-2.5 px-3 text-right font-semibold ${d.apacheIiScore >= 8 ? 'text-red-700' : 'text-slate-900'}`}>
                    {d.apacheIiScore}
                  </td>
                  <td className={`py-2.5 px-3 text-right ${d.bisapScore >= 3 ? 'text-red-700 font-semibold' : ''}`}>
                    {d.bisapScore}
                  </td>
                  <td className={`py-2.5 px-3 text-right font-semibold ${d.modifiedMarshallScore >= 2 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {d.modifiedMarshallScore}
                  </td>
                  <td className="py-2.5 px-3 text-right">Grade {d.agiGrade}</td>
                  <td className={`py-2.5 px-3 text-right ${d.labs.crpMgL >= 150 ? 'text-amber-700 font-semibold' : ''}`}>
                    {d.labs.crpMgL}
                  </td>
                  <td className="py-2.5 px-3 text-right">{d.labs.lipaseUL}</td>
                  <td className="py-2.5 px-3 text-right">{d.labs.hematocritPct}</td>
                  <td className="py-2.5 pl-3 text-right">{d.labs.creatinineMgDl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Interactive Calculator & HL7 FHIR R4 Panel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Interactive Severity Calculator & Day Entry</h3>
              <p className="mt-0.5 text-xs text-slate-500">Live preview updates all 5 clinical scales deterministically</p>
            </div>
            <Activity className="h-4 w-4 text-slate-400" />
          </div>

          <form onSubmit={handleSaveScaleDay} className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
                {([0, 1, 2, 7] as const).map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setSelectedDay(d)}
                    className={`rounded px-2.5 py-1 text-xs font-medium ${
                      selectedDay === d ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Day {d}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <label className="text-slate-600">AGI Grade:</label>
                <select
                  value={agiGrade}
                  onChange={(e) => setAgiGrade(Number(e.target.value) as 0 | 1 | 2 | 3 | 4)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-mono"
                >
                  <option value={0}>0 (Normal)</option>
                  <option value={1}>I (Self-limiting)</option>
                  <option value={2}>II (GI Dysfunction)</option>
                  <option value={3}>III (GI Failure)</option>
                  <option value={4}>IV (Life-threatening)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-xs">
              {[
                { key: 'crpMgL', label: 'CRP (mg/L)' },
                { key: 'amylaseUL', label: 'Amylase (U/L)' },
                { key: 'lipaseUL', label: 'Lipase (U/L)' },
                { key: 'hematocritPct', label: 'Hematocrit (%)' },
                { key: 'creatinineMgDl', label: 'Creatinine (mg/dL)' },
                { key: 'bunMgDl', label: 'BUN (mg/dL)' },
                { key: 'pao2Fio2', label: 'PaO2/FiO2' },
                { key: 'sbpMmHg', label: 'SBP (mmHg)' },
                { key: 'wbc10e9L', label: 'WBC (10⁹/L)' },
              ].map((field) => (
                <label key={field.key} className="block">
                  <span className="text-slate-600">{field.label}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={labsForm[field.key as keyof LabMarkers] as number}
                    onChange={(e) =>
                      setLabsForm((prev) => ({ ...prev, [field.key]: Number(e.target.value) }))
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs tabular-nums">
              <span>Ranson: <strong>{previewRanson}</strong></span>
              <span>APACHE II: <strong>{previewApache}</strong></span>
              <span>BISAP: <strong>{previewBisap}</strong></span>
              <span>Marshall: <strong>{previewMarshall}</strong></span>
              <span>AGI: <strong>{agiGrade}</strong></span>
            </div>

            <button
              type="submit"
              disabled={savingScale || role === 'data_scientist'}
              className="w-full rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {savingScale ? 'Saving Assessment...' : `Save Day ${selectedDay} Clinical Assessment`}
            </button>
          </form>
        </section>

        {/* HL7 FHIR R4 Integration */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">HL7 FHIR R4 Hospital HIS Gateway</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Import LOINC laboratory Observations or export FHIR DiagnosticReport
                </p>
              </div>
              <FileJson className="h-4 w-4 text-blue-700" />
            </div>

            <textarea
              value={fhirJson}
              onChange={(e) => setFhirJson(e.target.value)}
              rows={9}
              className="mt-3 w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 focus:border-blue-600 focus:outline-none"
            />

            {fhirStatus && (
              <div className="mt-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                {fhirStatus}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleFhirImport}
              disabled={role === 'data_scientist'}
              className="flex-1 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              Import HL7 FHIR Bundle
            </button>
            <button
              onClick={handleExportFhirReport}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Export FHIR DiagnosticReport
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
