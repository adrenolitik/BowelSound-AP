import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  ShieldAlert,
  Tag,
  Volume2,
} from 'lucide-react';
import { AcousticSegment, PatientRecord, SoundClass, UserRole } from '../types/clinical';
import { TRIPOD_MODEL_BENCHMARKS } from '../utils/clinicalScoring';
import { playBowelSoundSegment } from '../utils/audioDsp';
import {
  exportClinicalPdfReport,
  exportDatasetCSV,
  exportDatasetJSON,
  exportDatasetXLSX,
} from '../utils/exportReports';
import { apiFetch } from '../utils/apiClient';

interface ResearchAnnotationViewProps {
  patient: PatientRecord;
  role: UserRole;
  onPatientUpdated: (updated: PatientRecord) => void;
}

const LABEL_OPTIONS: { value: SoundClass; label: string }[] = [
  { value: 'bowel_sound', label: 'Bowel Sound' },
  { value: 'breathing', label: 'Breathing' },
  { value: 'friction', label: 'Clothing Friction' },
  { value: 'cough', label: 'Cough' },
  { value: 'snoring', label: 'Snoring' },
  { value: 'silence', label: 'White Noise / Silence' },
  { value: 'speech_purged', label: 'Speech (Purge & Exclude)' },
];

export const ResearchAnnotationView: React.FC<ResearchAnnotationViewProps> = ({
  patient,
  role,
  onPatientUpdated,
}) => {
  const [filterMode, setFilterMode] = useState<'disputed' | 'all'>('disputed');
  const [annotatingId, setAnnotatingId] = useState<string | null>(null);

  const isClinicianBlinded = role === 'clinician' && patient.blindingMode === 'double_blind';
  const segments = patient.segments ?? [];

  const filteredSegments = useMemo(() => {
    if (filterMode === 'all') return segments;
    return segments.filter((s) => s.confidence < 0.91 || s.verifiedByExpert);
  }, [segments, filterMode]);

  const handleAssignLabel = async (seg: AcousticSegment, label: SoundClass) => {
    setAnnotatingId(seg.id);
    const res = await apiFetch(`/api/patients/${patient.studyId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': role },
      body: JSON.stringify({ segmentId: seg.id, expertLabel: label }),
    });
    if (res.ok) {
      const data = await res.json();
      onPatientUpdated(data.patient);
    }
    setAnnotatingId(null);
  };

  return (
    <div className="space-y-6">
      {/* Research Dataset & Clinical Report Export Bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Dataset Export & Structured Clinical Report ({patient.studyId})
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Exports exclude all purged speech buffers and preserve valid-time denominators for Python / R / SPSS analysis
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => exportDatasetCSV(patient, role)}
              disabled={isClinicianBlinded}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button
              onClick={() => exportDatasetXLSX(patient, role)}
              disabled={isClinicianBlinded}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
              XLSX Workbook
            </button>
            <button
              onClick={() => exportDatasetJSON(patient, role)}
              disabled={isClinicianBlinded}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-blue-700" />
              JSON (TRIPOD+AI)
            </button>
            <button
              onClick={() => exportClinicalPdfReport(patient)}
              disabled={isClinicianBlinded || role === 'data_scientist'}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
            >
              <FileText className="h-3.5 w-3.5" />
              Clinical PDF Report
            </button>
          </div>
        </div>
      </section>

      {/* Manual Segment Annotation Tool */}
      {isClinicianBlinded ? (
        <section className="rounded-lg border border-slate-300 bg-slate-100 p-8 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-slate-700" />
          <h3 className="mt-3 text-base font-semibold text-slate-900">Acoustic Annotation Restricted in Double-Blind Mode</h3>
          <p className="mx-auto mt-1.5 max-w-xl text-sm text-slate-600">
            Treating clinicians cannot inspect or annotate acoustic segments while Double-Blind protocol is active. Switch to Researcher or Data Scientist role to verify segments.
          </p>
        </section>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Expert Manual Annotation Tool (CRNN Active Learning Queue)
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Verify disputed 5-second windows to refine the 5-layer CNN + BiGRU classifier (target F1 ≥ 0.81)
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
              <button
                onClick={() => setFilterMode('disputed')}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  filterMode === 'disputed' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Disputed (&lt;91% Conf.)
              </button>
              <button
                onClick={() => setFilterMode('all')}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  filterMode === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                All Windows ({segments.length})
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Window</th>
                  <th className="py-2 px-3 font-medium">CRNN Prediction</th>
                  <th className="py-2 px-3 font-medium text-right">Conf.</th>
                  <th className="py-2 px-3 font-medium text-right">Dom. Freq</th>
                  <th className="py-2 px-3 font-medium text-right">Amp (dB)</th>
                  <th className="py-2 px-3 font-medium">Audio</th>
                  <th className="py-2 pl-3 font-medium">Expert Ground-Truth Label</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSegments.slice(0, 14).map((seg) => (
                  <tr key={seg.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-mono text-slate-900 tabular-nums">
                      #{seg.windowIndex} ({seg.startSec}s)
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-800">
                      {LABEL_OPTIONS.find((o) => o.value === seg.classification)?.label ?? seg.classification}
                      {seg.verifiedByExpert && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Verified
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {(seg.confidence * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{seg.dominantFreqHz} Hz</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {seg.speechPurged ? 'PURGED' : seg.amplitudeDb}
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        onClick={() => playBowelSoundSegment(seg)}
                        disabled={seg.speechPurged}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                      >
                        <Volume2 className="h-3 w-3" />
                        Play
                      </button>
                    </td>
                    <td className="py-2.5 pl-3">
                      <div className="flex items-center gap-2">
                        <Tag className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <select
                          value={seg.expertLabel ?? seg.classification}
                          disabled={annotatingId === seg.id}
                          onChange={(e) => handleAssignLabel(seg, e.target.value as SoundClass)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          {LABEL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredSegments.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No disputed windows below 91% confidence in current recording block.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TRIPOD+AI ML Validation Matrix */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              TRIPOD+AI Model Validation & Prognostic Benchmark Suite
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Cross-validated comparison of BS-only vs Combined Clinico-Acoustic architectures (Event Detection F1 target ≥ 0.81)
            </p>
          </div>
          <FlaskConical className="h-4 w-4 text-blue-700" />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-4 font-medium">Model Architecture</th>
                <th className="py-2 px-3 font-medium">Family</th>
                <th className="py-2 px-3 font-medium">Input Scope</th>
                <th className="py-2 px-3 font-medium text-right">CRNN F1</th>
                <th className="py-2 px-3 font-medium text-right">SAP ROC-AUC</th>
                <th className="py-2 px-3 font-medium text-right">Sens / Spec</th>
                <th className="py-2 px-3 font-medium text-right">Brier</th>
                <th className="py-2 pl-3 font-medium text-right">Calib. Slope</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {TRIPOD_MODEL_BENCHMARKS.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-4 font-semibold text-slate-900">{m.name}</td>
                  <td className="py-2.5 px-3 text-slate-600">{m.family}</td>
                  <td className="py-2.5 px-3 text-slate-700">{m.inputScope}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                    {m.f1EventDetection.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-blue-800 tabular-nums">
                    {m.rocAucSap.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {m.sensitivity.toFixed(2)} / {m.specificity.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{m.brierScore.toFixed(3)}</td>
                  <td className="py-2.5 pl-3 text-right font-mono tabular-nums">{m.calibrationSlope.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
