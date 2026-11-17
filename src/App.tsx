import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  ClipboardList,
  FileText,
  FlaskConical,
  Menu,
  Shield,
  X,
} from 'lucide-react';
import {
  AuditLogEntry,
  GovernanceConfig,
  PatientRecord,
  UserRole,
} from './types/clinical';
import { BedsideMonitorView } from './components/BedsideMonitorView';
import { ClinicalAnalyticsView } from './components/ClinicalAnalyticsView';
import { PatientEcrfView } from './components/PatientEcrfView';
import { ResearchAnnotationView } from './components/ResearchAnnotationView';
import { GovernanceSecurityView } from './components/GovernanceSecurityView';
import { exportClinicalPdfReport } from './utils/exportReports';
import { apiFetch } from './utils/apiClient';

type WorkspaceTab = 'bedside' | 'analytics' | 'ecrf' | 'research' | 'governance';

const NAV_ITEMS: { id: WorkspaceTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'bedside', label: 'Bedside Monitor', icon: Activity },
  { id: 'analytics', label: 'Clinical Analytics', icon: BarChart3 },
  { id: 'ecrf', label: 'Patient eCRF & Therapy', icon: ClipboardList },
  { id: 'research', label: 'Research & Annotation', icon: FlaskConical },
  { id: 'governance', label: 'Governance & Security', icon: Shield },
];

const ROLE_OPTIONS: { value: UserRole; label: string; subtitle: string }[] = [
  { value: 'clinician', label: 'Clinician (ICU / Surgery)', subtitle: 'CDSS & bedside telemetry' },
  { value: 'researcher', label: 'Medical Researcher', subtitle: 'eCRF, SQA & annotations' },
  { value: 'data_scientist', label: 'Data Scientist (Blinded PII)', subtitle: 'Spectrograms & ML validation' },
  { value: 'admin', label: 'PI / System Admin', subtitle: 'RBAC, blinding & audit' },
];

export default function App() {
  const [role, setRole] = useState<UserRole>('clinician');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('bedside');
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<string>('BS-AP-0104');
  const [governance, setGovernance] = useState<GovernanceConfig | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveStreaming, setLiveStreaming] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const loadWorkspaceData = useCallback(async (activeRole: UserRole) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pRes, gRes] = await Promise.all([
        apiFetch('/api/patients', { headers: { 'x-user-role': activeRole } }),
        apiFetch('/api/governance', { headers: { 'x-user-role': activeRole } }),
      ]);
      if (!pRes.ok || !gRes.ok) {
        throw new Error(`Server returned HTTP ${pRes.status}/${gRes.status}`);
      }
      const pData = await pRes.json();
      const gData = await gRes.json();
      setPatients(pData.patients);
      setSelectedStudyId((prev) =>
        pData.patients.length > 0 && !pData.patients.some((p: PatientRecord) => p.studyId === prev)
          ? pData.patients[0].studyId
          : prev
      );
      setGovernance(gData.governance);
      setAuditLogs(gData.auditLogs);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to reach BowelSound-AP backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceData(role);
  }, [role, loadWorkspaceData]);

  const activePatient = patients.find((p) => p.studyId === selectedStudyId) ?? patients[0];

  // Live bedside telemetry stream interval when user activates streaming
  useEffect(() => {
    if (!liveStreaming || !activePatient) return;
    const timer = setInterval(async () => {
      const segCount = activePatient.segments?.length ?? 0;
      const isBs = Math.random() > 0.22;
      const pkt = [
        {
          id: `live-${Date.now()}`,
          windowIndex: segCount,
          startSec: segCount * 5,
          durationSec: 5 as const,
          classification: isBs ? ('bowel_sound' as const) : ('breathing' as const),
          confidence: 0.91,
          sqaValid: isBs,
          speechPurged: false,
          occurrenceCount: isBs ? Math.floor(2 + Math.random() * 4) : 0,
          eventDurationMeanSec: isBs ? Number((0.45 + Math.random() * 0.4).toFixed(2)) : 0,
          amplitudeDb: isBs ? Number((48 + Math.random() * 12).toFixed(1)) : 38.2,
          dominantFreqHz: isBs ? Math.round(230 + Math.random() * 180) : 130,
          spectralCentroidHz: isBs ? Math.round(280 + Math.random() * 190) : 160,
          interSoundIntervalSec: isBs ? Number((7 + Math.random() * 10).toFixed(1)) : null,
          mfccSummary: [-11.8, 7.1, 2.9, -1.2],
          waveformPeak: isBs ? Number((0.45 + Math.random() * 0.4).toFixed(2)) : 0.14,
        },
      ];
      const res = await apiFetch('/api/ingest/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify({
          studyId: activePatient.studyId,
          segments: pkt,
          originalSampleRateHz: activePatient.sensorStatus.sampleRateInputHz,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPatients((prev) => prev.map((p) => (p.studyId === data.patient.studyId ? data.patient : p)));
      }
    }, 4500);
    return () => clearInterval(timer);
  }, [liveStreaming, activePatient, role]);

  const handlePatientUpdated = (updated: PatientRecord) => {
    setPatients((prev) => prev.map((p) => (p.studyId === updated.studyId ? updated : p)));
    void apiFetch('/api/governance', { headers: { 'x-user-role': role } })
      .then((r) => r.json())
      .then((g) => setAuditLogs(g.auditLogs));
  };

  const handlePatientEnrolled = (created: PatientRecord) => {
    setPatients((prev) => [created, ...prev]);
    setSelectedStudyId(created.studyId);
    setActiveTab('bedside');
  };

  const currentNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Bedside Monitor';
  const canExportPdf =
    Boolean(activePatient) &&
    role !== 'data_scientist' &&
    !(role === 'clinician' && activePatient?.blindingMode === 'double_blind');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar (264px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white flex flex-col transition-transform lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            BowelSound-AP
          </span>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Workspace Navigation */}
        <nav className="space-y-1 border-b border-slate-200 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-blue-700' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Patient Cohort Selector */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Monitored Cohort ({patients.length})
          </div>
          <div className="space-y-1">
            {patients.map((p) => {
              const isSelected = p.studyId === activePatient?.studyId;
              return (
                <button
                  key={p.studyId}
                  onClick={() => {
                    setSelectedStudyId(p.studyId);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'border-blue-300 bg-blue-50/70'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">{p.studyId}</span>
                    {p.prognosis?.silentAbdomenAlert && (
                      <span className="text-[11px] font-semibold text-red-700">Alert</span>
                    )}
                    {p.blindingMode === 'double_blind' && !p.prognosis?.silentAbdomenAlert && (
                      <span className="text-[11px] font-medium text-amber-700">Blinded</span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-600">
                    {p.pii ? `${p.pii.bedNumber} · ${p.pii.fullName}` : `${p.centerCode} · De-identified`}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
                    {p.age}y {p.sex} · BMI {p.bmi} · {p.validMonitoringRatioPct}% valid
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* RBAC Role Switcher */}
        <div className="border-t border-slate-200 bg-slate-50 p-3">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Active RBAC Role
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-slate-500">
            {ROLE_OPTIONS.find((r) => r.value === role)?.subtitle}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb on Left, Single Primary Action on Right */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-6 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
              <span className="font-medium text-slate-900 whitespace-nowrap">{currentNavLabel}</span>
              {activePatient && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="font-mono font-semibold text-slate-800 whitespace-nowrap">
                    {activePatient.studyId}
                  </span>
                  <span aria-hidden="true" className="hidden sm:inline">·</span>
                  <span className="hidden sm:inline truncate">
                    {activePatient.pii
                      ? `${activePatient.pii.fullName} (${activePatient.pii.mrn})`
                      : `Center ${activePatient.centerCode} · PII Segregated`}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => activePatient && exportClinicalPdfReport(activePatient)}
              disabled={!canExportPdf}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
            >
              <FileText className="h-3.5 w-3.5" />
              Export Clinical PDF
            </button>
          </div>
        </header>

        {/* Patient Context Summary Bar */}
        {activePatient && (
          <div className="border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  Etiology: <strong className="text-slate-900">{activePatient.etiology}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {activePatient.age}y {activePatient.sex}, BMI {activePatient.bmi} kg/m²
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Onset-to-Enroll: {activePatient.hoursSinceOnsetAtAdmission}h
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Protocol:{' '}
                  <strong className={activePatient.blindingMode === 'double_blind' ? 'text-amber-800' : 'text-slate-900'}>
                    {activePatient.blindingMode === 'double_blind' ? 'Double-Blind' : 'Open-Label'}
                  </strong>
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                CRNN: {governance?.crnnModelVersion ?? 'CRNN-5L-BiGRU-v2.4.1'}
              </div>
            </div>
          </div>
        )}

        {/* Active Workspace Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {loadError ? (
            <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-sm text-red-900">
              <div className="font-semibold">Telemetry Connection Error</div>
              <p className="mt-1 text-red-800">{loadError}</p>
              <button
                onClick={() => void loadWorkspaceData(role)}
                className="mt-3 rounded-md bg-red-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-red-800"
              >
                Retry Connection
              </button>
            </div>
          ) : loading || !activePatient ? (
            <div className="space-y-4">
              <div className="h-32 rounded-lg border border-slate-200 bg-white animate-pulse" />
              <div className="h-64 rounded-lg border border-slate-200 bg-white animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab === 'bedside' && (
                <BedsideMonitorView
                  patient={activePatient}
                  role={role}
                  liveStreaming={liveStreaming}
                  onToggleLiveStream={() => setLiveStreaming((v) => !v)}
                  onPatientUpdated={handlePatientUpdated}
                />
              )}
              {activeTab === 'analytics' && (
                <ClinicalAnalyticsView
                  patient={activePatient}
                  role={role}
                  onPatientUpdated={handlePatientUpdated}
                />
              )}
              {activeTab === 'ecrf' && (
                <PatientEcrfView
                  patient={activePatient}
                  role={role}
                  onPatientUpdated={handlePatientUpdated}
                  onPatientEnrolled={handlePatientEnrolled}
                />
              )}
              {activeTab === 'research' && (
                <ResearchAnnotationView
                  patient={activePatient}
                  role={role}
                  onPatientUpdated={handlePatientUpdated}
                />
              )}
              {activeTab === 'governance' && governance && (
                <GovernanceSecurityView
                  patients={patients}
                  activePatient={activePatient}
                  role={role}
                  governance={governance}
                  auditLogs={auditLogs}
                  onPatientUpdated={handlePatientUpdated}
                  onGovernanceUpdated={(gov, logs) => {
                    setGovernance(gov);
                    setAuditLogs(logs);
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
