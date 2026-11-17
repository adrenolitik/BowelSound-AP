import React, { useState } from 'react';
import { EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { AuditLogEntry, BlindingMode, GovernanceConfig, PatientRecord, UserRole } from '../types/clinical';
import { apiFetch } from '../utils/apiClient';

interface GovernanceSecurityViewProps {
  patients: PatientRecord[];
  activePatient: PatientRecord;
  role: UserRole;
  governance: GovernanceConfig;
  auditLogs: AuditLogEntry[];
  onPatientUpdated: (updated: PatientRecord) => void;
  onGovernanceUpdated: (gov: GovernanceConfig, logs: AuditLogEntry[]) => void;
}

export const GovernanceSecurityView: React.FC<GovernanceSecurityViewProps> = ({
  patients,
  activePatient,
  role,
  governance,
  auditLogs,
  onPatientUpdated,
  onGovernanceUpdated,
}) => {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [crnnVersion, setCrnnVersion] = useState(governance.crnnModelVersion);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canModifyBlinding = role === 'admin' || role === 'researcher';
  const canModifyGov = role === 'admin';

  const handleToggleBlinding = async (target: PatientRecord) => {
    setErrorMsg(null);
    setUpdatingId(target.studyId);
    const nextMode: BlindingMode = target.blindingMode === 'double_blind' ? 'open_label' : 'double_blind';
    const res = await apiFetch(`/api/patients/${target.studyId}/blinding`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-role': role },
      body: JSON.stringify({ blindingMode: nextMode }),
    });
    if (res.ok) {
      const data = await res.json();
      onPatientUpdated(data.patient);
    } else {
      const err = await res.json();
      setErrorMsg(err.error ?? 'Permission denied');
    }
    setUpdatingId(null);
  };

  const handleSaveAlgorithm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const res = await apiFetch('/api/governance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-role': role },
      body: JSON.stringify({ crnnModelVersion: crnnVersion }),
    });
    if (res.ok) {
      const data = await res.json();
      onGovernanceUpdated(data.governance, data.auditLogs);
    } else {
      const err = await res.json();
      setErrorMsg(err.error ?? 'Admin permissions required');
    }
  };

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Double-Blind Protocol Control */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Double-Blind Study Control & Cohort Access
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                In Double-Blind mode, Clinicians see sensor technical status only; Data Scientists see acoustic data only
              </p>
            </div>
            <EyeOff className="h-4 w-4 text-slate-500" />
          </div>

          <div className="mt-4 divide-y divide-slate-100">
            {patients.map((p) => (
              <div key={p.studyId} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="font-mono text-xs font-semibold text-slate-900">
                    {p.studyId} {p.studyId === activePatient.studyId ? '· Active' : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    Center {p.centerCode} · {p.age}y {p.sex} · {p.etiology}
                  </div>
                </div>
                <button
                  onClick={() => handleToggleBlinding(p)}
                  disabled={!canModifyBlinding || updatingId === p.studyId}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    p.blindingMode === 'double_blind'
                      ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {p.blindingMode === 'double_blind' ? 'Double-Blind Active' : 'Open-Label Active'}
                </button>
              </div>
            ))}
          </div>
          {!canModifyBlinding && (
            <p className="mt-3 text-xs text-slate-500">
              Switch to Principal Investigator (Admin) or Medical Researcher role to toggle patient blinding.
            </p>
          )}
        </section>

        {/* Privacy, RBAC & Algorithm Governance */}
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Security, Privacy Architecture & Algorithm Versioning
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                HIPAA / GDPR compliance · Segregated PII vault · Zero speech segment retention
              </p>
            </div>
            <ShieldCheck className="h-4 w-4 text-emerald-700" />
          </div>

          <div className="mt-4 space-y-3 text-xs">
            <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-slate-600">Transport & At-Rest Encryption</span>
              <span className="font-mono font-medium text-slate-900">{governance.tlsAndAesStatus}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-slate-600">Speech Segment Storage Policy</span>
              <span className="font-semibold text-emerald-700">Strict Purge Enabled (0% Stored)</span>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-slate-600">Missing Data Imputation Policy</span>
              <span className="font-semibold text-slate-900">Prohibited (Valid Time Denominator)</span>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-slate-600">Active Clinical Centers</span>
              <span className="font-mono text-slate-900">{governance.activeCenters.join(' · ')}</span>
            </div>
          </div>

          <form onSubmit={handleSaveAlgorithm} className="mt-4 flex items-end gap-3 border-t border-slate-100 pt-4">
            <label className="flex-1 text-xs">
              <span className="text-slate-600">Active CRNN / ML Inference Version</span>
              <select
                value={crnnVersion}
                onChange={(e) => setCrnnVersion(e.target.value)}
                disabled={!canModifyGov}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs disabled:opacity-60"
              >
                <option value="CRNN-5L-BiGRU-v2.4.1">CRNN-5L-BiGRU-v2.4.1 (F1 0.86)</option>
                <option value="CRNN-5L-BiGRU-v2.3.0">CRNN-5L-BiGRU-v2.3.0 (F1 0.83)</option>
                <option value="CRNN-5L-BiGRU-v2.1.4">CRNN-5L-BiGRU-v2.1.4 (F1 0.81)</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={!canModifyGov}
              className="rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
            >
              Deploy Version
            </button>
          </form>
        </section>
      </div>

      {/* Immutable Audit Log */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Immutable User & Telemetry Audit Log</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Append-only security ledger recording RBAC access, blinding switches, audio ingestion, FHIR sync, and exports
            </p>
          </div>
          <Lock className="h-4 w-4 text-slate-400" />
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">Timestamp (UTC)</th>
                <th className="py-2 px-3 font-medium">Actor / Role</th>
                <th className="py-2 px-3 font-medium">Action</th>
                <th className="py-2 px-3 font-medium">Study ID</th>
                <th className="py-2 pl-3 font-medium">Audit Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-3 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                    {log.timestampIso.replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="py-2 px-3 text-slate-800 whitespace-nowrap">{log.actorName}</td>
                  <td className="py-2 px-3 font-mono text-[11px] font-semibold text-slate-900">{log.action}</td>
                  <td className="py-2 px-3 font-mono text-slate-700">{log.targetStudyId}</td>
                  <td className="py-2 pl-3 text-slate-600">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
