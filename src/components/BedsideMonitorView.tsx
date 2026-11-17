import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BatteryCharging,
  Bluetooth,
  CheckCircle2,
  Play,
  Radio,
  ShieldAlert,
  Upload,
  Usb,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import {
  AcousticSegment,
  AcousticTrendPoint,
  ConfounderEvent,
  PatientRecord,
  SoundClass,
  UserRole,
} from '../types/clinical';
import { adjustAmplitudeForBmi } from '../utils/clinicalScoring';
import { playBowelSoundSegment, processUploadedAudioFile } from '../utils/audioDsp';
import { apiFetch } from '../utils/apiClient';

interface BedsideMonitorViewProps {
  patient: PatientRecord;
  role: UserRole;
  liveStreaming: boolean;
  onToggleLiveStream: () => void;
  onPatientUpdated: (updated: PatientRecord) => void;
}

const CLASS_META: Record<SoundClass, { label: string; barColor: string; textColor: string }> = {
  bowel_sound: { label: 'Bowel Sound', barColor: '#16a34a', textColor: 'text-emerald-700' },
  breathing: { label: 'Breathing Artifact', barColor: '#64748b', textColor: 'text-slate-600' },
  friction: { label: 'Friction Artifact', barColor: '#94a3b8', textColor: 'text-slate-600' },
  cough: { label: 'Cough Artifact', barColor: '#64748b', textColor: 'text-slate-600' },
  snoring: { label: 'Snoring Artifact', barColor: '#64748b', textColor: 'text-slate-600' },
  silence: { label: 'Silence / Baseline', barColor: '#cbd5e1', textColor: 'text-slate-500' },
  speech_purged: { label: 'Signal Loss / Speech Purged', barColor: '#dc2626', textColor: 'text-red-700' },
};

export const BedsideMonitorView: React.FC<BedsideMonitorViewProps> = ({
  patient,
  role,
  liveStreaming,
  onToggleLiveStream,
  onPatientUpdated,
}) => {
  const [timeWindow, setTimeWindow] = useState<24 | 48 | 72>(48);
  const [rollingWindowMin, setRollingWindowMin] = useState<15 | 30 | 60>(30);
  const [bmiCorrection, setBmiCorrection] = useState<boolean>(true);
  const [selectedSegId, setSelectedSegId] = useState<string | null>(null);
  const [hoverHourIdx, setHoverHourIdx] = useState<number | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestionNotice, setIngestionNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isClinicianBlinded = role === 'clinician' && patient.blindingMode === 'double_blind';
  const segments = patient.segments ?? [];
  const selectedSeg: AcousticSegment | undefined =
    segments.find((s) => s.id === selectedSegId) ?? segments[0];

  const trendSlice = useMemo(() => {
    const raw = patient.trend72h ?? [];
    const sliced = raw.slice(-timeWindow);
    if (rollingWindowMin === 15) return sliced;
    // Apply lightweight causal smoothing for 30/60m rolling comparison while preserving null gaps
    const factor = rollingWindowMin === 60 ? 3 : 2;
    return sliced.map((pt, idx) => {
      if (pt.occurrenceRatePerMin === null) return pt;
      const win = sliced
        .slice(Math.max(0, idx - factor + 1), idx + 1)
        .filter((x) => x.occurrenceRatePerMin !== null);
      if (win.length === 0) return pt;
      const avg = (fn: (x: AcousticTrendPoint) => number | null) => {
        const vals = win.map(fn).filter((v): v is number => v !== null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      return {
        ...pt,
        occurrenceRatePerMin: Number((avg((x) => x.occurrenceRatePerMin) ?? pt.occurrenceRatePerMin).toFixed(2)),
        amplitudeDb: avg((x) => x.amplitudeDb) !== null ? Number(avg((x) => x.amplitudeDb)!.toFixed(1)) : pt.amplitudeDb,
        dominantFreqHz: avg((x) => x.dominantFreqHz) !== null ? Math.round(avg((x) => x.dominantFreqHz)!) : pt.dominantFreqHz,
        interSoundIntervalSec:
          avg((x) => x.interSoundIntervalSec) !== null ? Number(avg((x) => x.interSoundIntervalSec)!.toFixed(1)) : pt.interSoundIntervalSec,
      };
    });
  }, [patient.trend72h, timeWindow, rollingWindowMin]);

  const latestValid = useMemo(() => {
    const valid = trendSlice.filter((p) => p.occurrenceRatePerMin !== null);
    return valid[valid.length - 1] ?? null;
  }, [trendSlice]);

  const handleToggleSensorDetachment = async () => {
    const nextDetached = !patient.sensorStatus.detached;
    const res = await apiFetch(`/api/patients/${patient.studyId}/sensor`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-role': role },
      body: JSON.stringify({
        detached: nextDetached,
        contactQualityPct: nextDetached ? 14 : 95,
        bufferedFrames: nextDetached ? patient.sensorStatus.bufferedFrames + 18 : 0,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      onPatientUpdated(data.patient);
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIngesting(true);
    setIngestionNotice(null);
    try {
      const result = await processUploadedAudioFile(file, segments.length);
      const res = await apiFetch('/api/ingest/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': role },
        body: JSON.stringify({
          studyId: patient.studyId,
          segments: result.segments,
          originalSampleRateHz: result.originalSampleRateHz,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onPatientUpdated(data.patient);
        setIngestionNotice(
          `Processed ${file.name}: ${result.originalSampleRateHz} Hz resampled to 4,000 Hz (${result.segments.length} windows, ${result.validDurationSec}s valid, ${data.purgedCount} speech segments purged).`
        );
      }
    } catch (err) {
      setIngestionNotice(`Audio decode error: ${err instanceof Error ? err.message : 'Unsupported WAV/PCM format'}`);
    } finally {
      setIngesting(false);
      e.target.value = '';
    }
  };

  const handleSimulateGatewayPacket = async () => {
    setIngesting(true);
    setIngestionNotice(null);
    const nowIdx = segments.length;
    const sampleClasses: SoundClass[] = ['bowel_sound', 'bowel_sound', 'breathing', 'bowel_sound', 'speech_purged', 'bowel_sound'];
    const syntheticPacket: AcousticSegment[] = sampleClasses.map((cls, idx) => {
      const isBs = cls === 'bowel_sound';
      const isSpeech = cls === 'speech_purged';
      return {
        id: `pkt-${Date.now()}-${idx}`,
        windowIndex: nowIdx + idx,
        startSec: (nowIdx + idx) * 5,
        durationSec: 5,
        classification: cls,
        confidence: 0.89,
        sqaValid: isBs,
        speechPurged: isSpeech,
        sqaReason: isSpeech
          ? 'Speech detected & purged at gateway'
          : !isBs
          ? 'Respiratory artifact rejected by SQA'
          : undefined,
        occurrenceCount: isBs ? 2 + (idx % 3) : 0,
        eventDurationMeanSec: isBs ? 0.58 : 0,
        amplitudeDb: isSpeech ? 0 : isBs ? 53.4 : 44.1,
        dominantFreqHz: isBs ? 285 + idx * 18 : 130,
        spectralCentroidHz: isBs ? 336 + idx * 20 : 165,
        interSoundIntervalSec: isBs ? 9.4 : null,
        mfccSummary: [-11.4, 7.2, 3.0, -1.1],
        waveformPeak: isSpeech ? 0 : isBs ? 0.62 : 0.14,
      };
    });

    const res = await apiFetch('/api/ingest/audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': role },
      body: JSON.stringify({
        studyId: patient.studyId,
        segments: syntheticPacket,
        originalSampleRateHz: 16000,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      onPatientUpdated(data.patient);
      setIngestionNotice(
        `Gateway block ingested (16 kHz -> 4 kHz unified): 6 non-overlapping 5s windows, 1 speech segment purged.`
      );
    }
    setIngesting(false);
  };

  return (
    <div className="space-y-6">
      {/* Inadequate 48h Monitoring Warning */}
      {patient.insufficient48hWarning && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold">Insufficient Valid Monitoring in First 48 Hours</p>
              <p className="mt-0.5 text-amber-800">
                Accumulated valid recording time is <span className="font-mono tabular-nums font-medium">{patient.validMonitoringHours}h</span> out of{' '}
                <span className="font-mono tabular-nums">{patient.totalMonitoringHours}h</span> (below the 24.0h threshold). Denominators strictly exclude artifact/detachment gaps; no synthetic imputation is applied.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sensor & Gateway Status Strip */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Contact Acoustic Sensor & Gateway Telemetry</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {patient.sensorStatus.connectionType} · Input {patient.sensorStatus.sampleRateInputHz.toLocaleString()} Hz resampled to {patient.sensorStatus.sampleRateUnifiedHz.toLocaleString()} Hz · 5s windows / 100ms MFCC hop
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onToggleLiveStream}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                liveStreaming
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {liveStreaming && <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />}
              <Radio className="h-3.5 w-3.5" />
              {liveStreaming ? 'Live Stream Active' : 'Start Live Stream'}
            </button>
            <button
              onClick={handleToggleSensorDetachment}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                patient.sensorStatus.detached
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {patient.sensorStatus.detached ? <WifiOff className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
              {patient.sensorStatus.detached ? 'Reconnect Sensor' : 'Test Detach / Buffer'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4 lg:grid-cols-5">
          <div>
            <div className="text-xs text-slate-500">Sensor Link & Power</div>
            <div className="mt-1 flex items-center gap-2 font-mono text-lg font-semibold text-slate-900 tabular-nums">
              {patient.sensorStatus.connectionType === 'USB-C' ? (
                <Usb className="h-4 w-4 text-blue-600" />
              ) : (
                <Bluetooth className="h-4 w-4 text-blue-600" />
              )}
              <span>{patient.sensorStatus.batteryPct}%</span>
              <BatteryCharging className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
              RSSI {patient.sensorStatus.signalStrengthDbm} dBm · {patient.sensorStatus.detached ? 'DETACHED' : 'Recording'}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Acoustic Contact Index</div>
            <div
              className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                patient.sensorStatus.contactQualityPct >= 80
                  ? 'text-emerald-700'
                  : patient.sensorStatus.contactQualityPct >= 50
                  ? 'text-amber-700'
                  : 'text-red-700'
              }`}
            >
              {patient.sensorStatus.contactQualityPct}%
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {patient.sensorStatus.detached ? 'Adhesive patch lifted' : 'Nominal skin coupling'}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Valid Monitoring Ratio</div>
            <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
              {patient.validMonitoringRatioPct}%
            </div>
            <div className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
              {patient.validMonitoringHours}h valid / {patient.totalMonitoringHours}h total
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Gateway Offline Buffer</div>
            <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
              {patient.sensorStatus.bufferedFrames} frames
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {patient.sensorStatus.bufferedFrames > 0 ? 'Pending timestamp sync' : 'Zero packet loss'}
            </div>
          </div>

          <div className="col-span-2 sm:col-span-4 lg:col-span-1 flex flex-col justify-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.pcm"
              onChange={handleAudioFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={ingesting}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" />
              {ingesting ? 'Processing DSP...' : 'Upload WAV/PCM'}
            </button>
            <button
              onClick={handleSimulateGatewayPacket}
              disabled={ingesting}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
            >
              Ingest 30s Telemetry Block
            </button>
          </div>
        </div>

        {ingestionNotice && (
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            {ingestionNotice}
          </div>
        )}
      </section>

      {/* Double-Blind Redaction Gate for Treating Clinicians */}
      {isClinicianBlinded ? (
        <section className="rounded-lg border border-slate-300 bg-slate-100 p-8 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-slate-700" />
          <h3 className="mt-3 text-base font-semibold text-slate-900">Double-Blind Study Protocol Active</h3>
          <p className="mx-auto mt-1.5 max-w-xl text-sm text-slate-600">
            {patient.blindedRedactionNotice}
          </p>
          <p className="mt-3 font-mono text-xs text-slate-500">
            Active Role: Clinician · Technical sensor status remains unblinded for safety and patch maintenance.
          </p>
        </section>
      ) : (
        <>
          {/* 5 Core Acoustic Biomarkers Strip */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">01. Occurrence Rate</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {latestValid?.occurrenceRatePerMin ?? '—'}
                </span>
                <span className="font-mono text-xs text-slate-400">events/min</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">Valid-time denominator only</div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">02. Event Duration</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {latestValid?.durationMeanSec ?? '—'}
                </span>
                <span className="font-mono text-xs text-slate-400">s mean</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                Median: {latestValid?.durationMedianSec ?? '—'} s
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">03. Amplitude</span>
                <button
                  onClick={() => setBmiCorrection((v) => !v)}
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium border ${
                    bmiCorrection
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}
                >
                  {bmiCorrection ? 'BMI Adj ON' : 'Raw dB'}
                </button>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {latestValid?.amplitudeDb !== null && latestValid?.amplitudeDb !== undefined
                    ? adjustAmplitudeForBmi(latestValid.amplitudeDb, patient.bmi, bmiCorrection)
                    : '—'}
                </span>
                <span className="font-mono text-xs text-slate-400">dB SPL</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                Patient BMI: {patient.bmi} kg/m²
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">04. Dominant Frequency</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {latestValid?.dominantFreqHz ?? '—'}
                </span>
                <span className="font-mono text-xs text-slate-400">Hz</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                Centroid: {latestValid?.spectralCentroidHz ?? '—'} Hz
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">05. Inter-Sound Interval</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {latestValid?.interSoundIntervalSec ?? '—'}
                </span>
                <span className="font-mono text-xs text-slate-400">sec</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">Consecutive peristalsis gap</div>
            </div>
          </section>

          {/* Interactive Phonoenterogram & Spectrogram */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Interactive Phonoenterogram & CRNN Spectrogram (5s Non-Overlapping Windows)
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Green = Bowel Sound · Gray = Breathing/Friction/Cough · Red = Signal Loss / Speech Purged (never stored or playable)
                </p>
              </div>
              {selectedSeg && (
                <button
                  onClick={() => playBowelSoundSegment(selectedSeg)}
                  disabled={selectedSeg.speechPurged || selectedSeg.classification === 'speech_purged'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 whitespace-nowrap shrink-0"
                >
                  {selectedSeg.speechPurged ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  {selectedSeg.speechPurged ? 'Speech Buffer Purged' : `Play Window #${selectedSeg.windowIndex}`}
                </button>
              )}
            </div>

            {/* Waveform + Spectrogram Strip */}
            <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className="rounded-md border border-slate-200 bg-slate-950 p-4">
                  <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-slate-400">
                    <span>PHONOENTEROGRAM ENVELOPE & CRNN CLASS</span>
                    <span>{segments.length} x 5s WINDOWS (4,000 Hz UNIFIED)</span>
                  </div>

                  {/* Interactive 5s bars */}
                  <div className="flex h-28 items-end gap-1 border-b border-slate-800 pb-2">
                    {segments.map((seg) => {
                      const meta = CLASS_META[seg.classification];
                      const isSelected = selectedSeg?.id === seg.id;
                      const heightPct = seg.speechPurged ? 18 : Math.max(12, Math.round(seg.waveformPeak * 100));
                      return (
                        <button
                          key={seg.id}
                          onClick={() => setSelectedSegId(seg.id)}
                          title={`Window #${seg.windowIndex} (${seg.startSec}s): ${meta.label}`}
                          className={`group relative flex-1 min-w-[6px] h-full flex items-end rounded-t-sm transition-opacity ${
                            isSelected ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-950' : 'opacity-90 hover:opacity-100'
                          }`}
                        >
                          <span
                            className="w-full rounded-t-sm transition-all"
                            style={{
                              height: `${heightPct}%`,
                              backgroundColor: meta.barColor,
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>

                  {/* Simulated Mel-Spectrogram Heatmap (100ms frame proxy across windows) */}
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-slate-400">
                      <span>MEL-SPECTROGRAM (100–1,000 Hz BANDPASS)</span>
                      <span>1,000 Hz ↑ / 100 Hz ↓</span>
                    </div>
                    <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${Math.max(1, segments.length)}, minmax(0, 1fr))` }}>
                      {[4, 3, 2, 1, 0].map((band) =>
                        segments.map((seg) => {
                          const peakHz = seg.dominantFreqHz;
                          const bandCenter = 150 + band * 190;
                          const dist = Math.abs(peakHz - bandCenter);
                          const intensity = seg.speechPurged
                            ? 0
                            : seg.classification === 'bowel_sound'
                            ? Math.max(0.12, 1 - dist / 450)
                            : 0.18;
                          const bg =
                            seg.speechPurged
                              ? 'rgba(220, 38, 38, 0.35)'
                              : seg.classification === 'bowel_sound'
                              ? `rgba(16, 185, 129, ${intensity.toFixed(2)})`
                              : `rgba(148, 163, 184, ${intensity.toFixed(2)})`;
                          return (
                            <div
                              key={`${seg.id}-b${band}`}
                              onClick={() => setSelectedSegId(seg.id)}
                              className="h-3.5 cursor-pointer"
                              style={{ backgroundColor: bg }}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Selected Segment Inspector */}
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                {selectedSeg ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        Window #{selectedSeg.windowIndex} · {selectedSeg.startSec}s–{selectedSeg.startSec + 5}s
                      </span>
                      <span className={`text-xs font-semibold ${CLASS_META[selectedSeg.classification].textColor}`}>
                        {CLASS_META[selectedSeg.classification].label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3 text-xs">
                      <div>
                        <div className="text-slate-500">CRNN Confidence</div>
                        <div className="font-mono font-semibold text-slate-900 tabular-nums">
                          {(selectedSeg.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">SQA Status</div>
                        <div className={`font-semibold ${selectedSeg.sqaValid ? 'text-emerald-700' : 'text-red-700'}`}>
                          {selectedSeg.sqaValid ? 'Valid Segment' : 'Rejected'}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Dominant Freq</div>
                        <div className="font-mono font-semibold text-slate-900 tabular-nums">
                          {selectedSeg.dominantFreqHz} Hz
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Amplitude</div>
                        <div className="font-mono font-semibold text-slate-900 tabular-nums">
                          {selectedSeg.speechPurged
                            ? 'PURGED'
                            : `${adjustAmplitudeForBmi(selectedSeg.amplitudeDb, patient.bmi, bmiCorrection)} dB`}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Detected Bursts</div>
                        <div className="font-mono font-semibold text-slate-900 tabular-nums">
                          {selectedSeg.occurrenceCount} events
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">MFCC [c1..c4]</div>
                        <div className="font-mono text-[11px] text-slate-700 tabular-nums">
                          {selectedSeg.mfccSummary.join(', ')}
                        </div>
                      </div>
                    </div>

                    {selectedSeg.sqaReason && (
                      <div className="rounded border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700">
                        {selectedSeg.sqaReason}
                      </div>
                    )}

                    <button
                      onClick={() => playBowelSoundSegment(selectedSeg)}
                      disabled={selectedSeg.speechPurged || selectedSeg.classification === 'speech_purged'}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {selectedSeg.speechPurged ? 'Audio Purged for Privacy' : 'Audition Isolated Bowel Sound'}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Select a 5-second window to inspect CRNN features.</p>
                )}
              </div>
            </div>
          </section>

          {/* Synchronized Dynamic Trend Charts (24 / 48 / 72+ hours) */}
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Synchronized Longitudinal Trends & Clinical Event Overlays
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Gaps indicate sensor detachment/artifact windows (no synthetic imputation). Dashed vertical markers indicate medications and EN events.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
                  {([24, 48, 72] as const).map((w) => (
                    <button
                      key={w}
                      onClick={() => setTimeWindow(w)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        timeWindow === w ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {w}h Window
                    </button>
                  ))}
                </div>
                <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
                  {([15, 30, 60] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRollingWindowMin(r)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        rollingWindowMin === r ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {r}m Avg
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <SynchronizedTrendChart
                data={trendSlice}
                confounders={patient.confounders ?? []}
                bmi={patient.bmi}
                bmiCorrection={bmiCorrection}
                hoverIdx={hoverHourIdx}
                onHoverIdx={setHoverHourIdx}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
};

interface SynchronizedTrendChartProps {
  data: AcousticTrendPoint[];
  confounders: ConfounderEvent[];
  bmi: number;
  bmiCorrection: boolean;
  hoverIdx: number | null;
  onHoverIdx: (idx: number | null) => void;
}

const SynchronizedTrendChart: React.FC<SynchronizedTrendChartProps> = ({
  data,
  confounders,
  bmi,
  bmiCorrection,
  hoverIdx,
  onHoverIdx,
}) => {
  if (data.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-500">No acoustic telemetry recorded yet.</div>;
  }

  const width = 920;
  const heightTop = 150;
  const heightBottom = 130;
  const padL = 44;
  const padR = 16;
  const chartW = width - padL - padR;

  const minHour = data[0].hourOffset;
  const maxHour = Math.max(minHour + 1, data[data.length - 1].hourOffset);
  const xForHour = (h: number) => padL + ((h - minHour) / (maxHour - minHour)) * chartW;

  const maxRate = Math.max(10, ...data.map((d) => d.occurrenceRatePerMin ?? 0));
  const yRate = (val: number) => heightTop - 16 - (val / maxRate) * (heightTop - 32);

  const maxIsi = 60;
  const yIsi = (val: number) => heightTop - 16 - (Math.min(maxIsi, val) / maxIsi) * (heightTop - 32);

  const yAmp = (val: number) => heightBottom - 16 - (Math.max(0, Math.min(80, val) - 20) / 60) * (heightBottom - 30);
  const yFreq = (val: number) => heightBottom - 16 - (Math.max(0, Math.min(600, val) - 100) / 500) * (heightBottom - 30);

  const buildSegmentedPath = (accessor: (d: AcousticTrendPoint) => number | null, yMapper: (v: number) => number) => {
    let path = '';
    let drawing = false;
    data.forEach((pt) => {
      const val = accessor(pt);
      if (val === null) {
        drawing = false;
        return;
      }
      const x = xForHour(pt.hourOffset).toFixed(1);
      const y = yMapper(val).toFixed(1);
      path += drawing ? ` L ${x} ${y}` : ` M ${x} ${y}`;
      drawing = true;
    });
    return path;
  };

  const hovered = hoverIdx !== null ? data[hoverIdx] : data[data.length - 1];
  const visibleConfounders = confounders.filter((c) => c.hourOffset >= minHour && c.hourOffset <= maxHour);

  return (
    <div className="space-y-3">
      {/* Live Crosshair Telemetry Readout */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs tabular-nums">
        <div className="text-slate-700">
          Hour <span className="font-semibold text-slate-900">T+{hovered.hourOffset}h</span> · Valid:{' '}
          <span className="font-semibold">{Math.round((hovered.validSecondsInHour / 3600) * 100)}%</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-blue-700">Rate: {hovered.occurrenceRatePerMin ?? 'GAP'} /min</span>
          <span className="text-amber-700">ISI: {hovered.interSoundIntervalSec ?? 'GAP'} s</span>
          <span className="text-emerald-700">
            Amp: {hovered.amplitudeDb !== null ? adjustAmplitudeForBmi(hovered.amplitudeDb, bmi, bmiCorrection) : 'GAP'} dB
          </span>
          <span className="text-slate-700">Freq: {hovered.dominantFreqHz ?? 'GAP'} Hz</span>
        </div>
      </div>

      {/* Top Panel: Occurrence Rate & Inter-Bowel-Sound Interval */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${heightTop}`}
          className="w-full min-w-[680px] cursor-crosshair select-none"
          onMouseLeave={() => onHoverIdx(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * width;
            const norm = Math.max(0, Math.min(1, (relX - padL) / chartW));
            const idx = Math.round(norm * (data.length - 1));
            onHoverIdx(idx);
          }}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((g) => {
            const y = 16 + g * (heightTop - 32);
            const rateLabel = ((1 - g) * maxRate).toFixed(1);
            return (
              <g key={g}>
                <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                <text x={padL - 6} y={y + 3} textAnchor="end" className="fill-slate-400 font-mono text-[10px]">
                  {rateLabel}
                </text>
              </g>
            );
          })}

          {/* Missing data gap shading */}
          {data.map((pt, i) =>
            pt.occurrenceRatePerMin === null ? (
              <rect
                key={`gap-${i}`}
                x={xForHour(pt.hourOffset) - 4}
                y={16}
                width={Math.max(8, chartW / data.length)}
                height={heightTop - 32}
                fill="#fee2e2"
                opacity="0.65"
              />
            ) : null
          )}

          {/* Confounder vertical markers */}
          {visibleConfounders.map((cf) => {
            const x = xForHour(cf.hourOffset);
            return (
              <g key={cf.id}>
                <line x1={x} y1={14} x2={x} y2={heightTop - 16} stroke="#0f172a" strokeDasharray="3 3" strokeWidth="1" />
                <text x={x + 3} y={24} className="fill-slate-700 font-mono text-[9px] font-medium">
                  {cf.agentName.slice(0, 14)}
                </text>
              </g>
            );
          })}

          <path
            d={buildSegmentedPath((d) => d.interSoundIntervalSec, yIsi)}
            fill="none"
            stroke="#d97706"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <path
            d={buildSegmentedPath((d) => d.occurrenceRatePerMin, yRate)}
            fill="none"
            stroke="#1d4ed8"
            strokeWidth="2.2"
          />

          {hoverIdx !== null && data[hoverIdx] && (
            <line
              x1={xForHour(data[hoverIdx].hourOffset)}
              y1={14}
              x2={xForHour(data[hoverIdx].hourOffset)}
              y2={heightTop - 16}
              stroke="#475569"
              strokeWidth="1"
            />
          )}
        </svg>

        {/* Bottom Panel: Amplitude (dB) & Dominant Frequency (Hz) */}
        <svg viewBox={`0 0 ${width} ${heightBottom}`} className="w-full min-w-[680px] select-none">
          {[0, 0.5, 1].map((g) => {
            const y = 14 + g * (heightBottom - 30);
            const dbLabel = Math.round(80 - g * 60);
            return (
              <g key={g}>
                <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                <text x={padL - 6} y={y + 3} textAnchor="end" className="fill-slate-400 font-mono text-[10px]">
                  {dbLabel}dB
                </text>
              </g>
            );
          })}

          <path
            d={buildSegmentedPath((d) => d.dominantFreqHz, yFreq)}
            fill="none"
            stroke="#475569"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <path
            d={buildSegmentedPath(
              (d) => (d.amplitudeDb !== null ? adjustAmplitudeForBmi(d.amplitudeDb, bmi, bmiCorrection) : null),
              yAmp
            )}
            fill="none"
            stroke="#059669"
            strokeWidth="2"
          />

          {hoverIdx !== null && data[hoverIdx] && (
            <line
              x1={xForHour(data[hoverIdx].hourOffset)}
              y1={14}
              x2={xForHour(data[hoverIdx].hourOffset)}
              y2={heightBottom - 16}
              stroke="#475569"
              strokeWidth="1"
            />
          )}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-5 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-blue-700 inline-block" /> Occurrence Rate (events/min)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-amber-600 inline-block" /> Inter-Sound Interval (s)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-emerald-600 inline-block" /> Amplitude (dB)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-slate-600 inline-block" /> Dominant Frequency (Hz)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 bg-red-100 border border-red-200 inline-block" /> Sensor Gap (No Imputation)
        </span>
      </div>
    </div>
  );
};
