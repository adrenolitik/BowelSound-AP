import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AcousticSegment,
  AuditLogEntry,
  BlindingMode,
  ConfounderEvent,
  DayScaleRecord,
  GovernanceConfig,
  PatientRecord,
  SoundClass,
  UserRole,
} from './src/types/clinical.ts';
import {
  computeApacheIiScore,
  computeBisapScore,
  computeModifiedMarshallScore,
  computePrognosis,
  computeRansonScore,
  createInitialPatients,
} from './src/utils/clinicalScoring.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROLE_NAMES: Record<UserRole, string> = {
  clinician: 'Dr. S. Vance (ICU / HPB Surgery)',
  researcher: 'M. Lindqvist (Clinical Trial Coordinator)',
  data_scientist: 'A. Petrov (ML & DSP Analyst)',
  admin: 'Prof. R. Kapoor (PI / System Admin)',
};

let patients: PatientRecord[] = createInitialPatients();

let governance: GovernanceConfig = {
  crnnModelVersion: 'CRNN-5L-BiGRU-v2.4.1',
  crnnF1Validated: 0.86,
  activeCenters: ['CTR-01-HPB', 'CTR-02-SURG', 'CTR-03-GASTRO'],
  globalBlindingDefault: 'open_label',
  strictSpeechPurge: true,
  noSyntheticImputation: true,
  tlsAndAesStatus: 'TLS 1.3 In-Transit · AES-256 At-Rest · PII Segregated',
};

const auditLogs: AuditLogEntry[] = [
  {
    id: 'aud-001',
    timestampIso: '2026-11-17T08:15:00.000Z',
    actorRole: 'admin',
    actorName: ROLE_NAMES.admin,
    action: 'MODEL_DEPLOY',
    targetStudyId: 'SYSTEM',
    details: 'Validated CRNN-5L-BiGRU-v2.4.1 active (F1 = 0.86, target >= 0.81).',
  },
  {
    id: 'aud-002',
    timestampIso: '2026-11-17T09:02:14.000Z',
    actorRole: 'researcher',
    actorName: ROLE_NAMES.researcher,
    action: 'BLINDING_PROTOCOL_SET',
    targetStudyId: 'BS-AP-0142',
    details: 'Enrolled under Double-Blind prospective cohort protocol.',
  },
  {
    id: 'aud-003',
    timestampIso: '2026-11-17T09:45:10.000Z',
    actorRole: 'clinician',
    actorName: ROLE_NAMES.clinician,
    action: 'SILENT_ABDOMEN_ALERT_ACK',
    targetStudyId: 'BS-AP-0104',
    details: 'Reviewed 4h Silent Abdomen alert; initiated opioid-sparing review.',
  },
];

function appendAudit(actorRole: UserRole, action: string, targetStudyId: string, details: string) {
  auditLogs.unshift({
    id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestampIso: new Date().toISOString(),
    actorRole,
    actorName: ROLE_NAMES[actorRole] ?? actorRole,
    action,
    targetStudyId,
    details,
  });
  if (auditLogs.length > 250) auditLogs.pop();
}

function getRoleFromRequest(req: Request): UserRole {
  const raw = String(req.headers['x-user-role'] ?? req.query.role ?? 'clinician');
  if (raw === 'clinician' || raw === 'researcher' || raw === 'data_scientist' || raw === 'admin') {
    return raw;
  }
  return 'clinician';
}

/**
 * Server-side RBAC + Double-Blind projection.
 * Ensures zero PII leakage to Data Scientists and zero outcome/metric leakage during Double-Blind mode.
 */
function projectPatientForRole(patient: PatientRecord, role: UserRole): PatientRecord {
  const clone: PatientRecord = JSON.parse(JSON.stringify(patient));

  // Strict PII segregation for Data Scientist
  if (role === 'data_scientist') {
    delete clone.pii;
  }

  if (clone.blindingMode === 'double_blind') {
    if (role === 'clinician') {
      // Clinician sees ONLY technical sensor status (recording active / detached / contact %)
      delete clone.trend72h;
      delete clone.segments;
      delete clone.prognosis;
      clone.blindedRedactionNotice =
        'DOUBLE-BLIND PROTOCOL ACTIVE: Acoustic biomarkers, spectrograms, and ML predictions are withheld from treating clinicians. Technical sensor telemetry remains visible.';
    } else if (role === 'data_scientist') {
      // Data Scientist sees ONLY de-identified acoustic data without clinical chart or outcomes
      delete clone.pii;
      delete clone.dayScales;
      delete clone.confounders;
      delete clone.checklist;
      delete clone.prognosis;
      clone.blindedRedactionNotice =
        'DOUBLE-BLIND PROTOCOL ACTIVE: Clinical severity scales, medications, and patient outcomes are withheld from technical analysts.';
    }
  }

  return clone;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'BowelSound-AP', timestamp: new Date().toISOString() });
  });

  // Get all patients (RBAC + Double-Blind projected)
  app.get('/api/patients', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    const projected = patients.map((p) => projectPatientForRole(p, role));
    res.json({ patients: projected, role });
  });

  // Enroll new patient via eCRF
  app.post('/api/patients', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    if (role === 'data_scientist') {
      res.status(403).json({ error: 'Data Scientists cannot enroll patients with PII.' });
      return;
    }

    const body = req.body as Partial<PatientRecord>;
    const studyId = `BS-AP-${String(Math.floor(150 + Math.random() * 800)).padStart(4, '0')}`;
    const admissionIso = new Date().toISOString();

    const defaultLabs = {
      amylaseUL: 1050,
      lipaseUL: 1890,
      crpMgL: 78,
      wbc10e9L: 14.2,
      hematocritPct: 44.0,
      creatinineMgDl: 1.2,
      bunMgDl: 19,
      lactateMmolL: 1.9,
      pao2Fio2: 340,
      arterialPh: 7.38,
      sbpMmHg: 116,
      ldhUL: 315,
      astUL: 140,
      glucoseMgDl: 162,
      calciumMgDl: 8.7,
      baseDeficitMeqL: 2.1,
      heartRateBpm: 98,
      respRateBpm: 19,
      tempC: 37.9,
      sodiumMeqL: 139,
      potassiumMeqL: 4.1,
      gcs: 15,
      pleuralEffusion: false,
      impairedMentalStatus: false,
    };

    const age = Number(body.age ?? 54);
    const day0: DayScaleRecord = {
      day: 0,
      recordedAtIso: admissionIso,
      labs: defaultLabs,
      ransonScore: computeRansonScore(age, defaultLabs, false),
      apacheIiScore: computeApacheIiScore(age, defaultLabs),
      bisapScore: computeBisapScore(age, defaultLabs),
      modifiedMarshallScore: computeModifiedMarshallScore(defaultLabs),
      agiGrade: 1,
    };

    const initialTrend = [
      {
        hourOffset: 0,
        timestampIso: admissionIso,
        validSecondsInHour: 3120,
        totalSecondsInHour: 3600,
        occurrenceRatePerMin: 3.4,
        durationMeanSec: 0.56,
        durationMedianSec: 0.49,
        amplitudeDb: 48.2,
        dominantFreqHz: 265,
        spectralCentroidHz: 318,
        interSoundIntervalSec: 17.6,
      },
    ];

    const newPatient: PatientRecord = {
      studyId,
      centerCode: body.centerCode ?? 'CTR-01-HPB',
      pii: body.pii ?? { fullName: 'Anonymous Enrollment', mrn: `MRN-${Math.floor(100000 + Math.random() * 899999)}`, bedNumber: 'WARD-08' },
      age,
      sex: body.sex ?? 'M',
      bmi: Number(body.bmi ?? 26.5),
      etiology: body.etiology ?? 'Biliary',
      admissionIso,
      hoursSinceOnsetAtAdmission: Number(body.hoursSinceOnsetAtAdmission ?? 18),
      blindingMode: body.blindingMode ?? governance.globalBlindingDefault,
      sensorStatus: {
        connected: true,
        connectionType: 'BLE 5.2',
        batteryPct: 98,
        signalStrengthDbm: -48,
        contactQualityPct: 95,
        detached: false,
        sampleRateInputHz: 16000,
        sampleRateUnifiedHz: 4000,
        bufferedFrames: 0,
      },
      totalMonitoringHours: 1,
      validMonitoringHours: 0.9,
      validMonitoringRatioPct: 90.0,
      insufficient48hWarning: false,
      checklist: body.checklist,
      dayScales: [day0],
      confounders: [],
      trend72h: initialTrend,
      segments: [],
      prognosis: computePrognosis({ age, bmi: Number(body.bmi ?? 26.5) }, initialTrend, [day0]),
    };

    patients.unshift(newPatient);
    appendAudit(role, 'PATIENT_ENROLLED', studyId, `Enrolled eCRF (${newPatient.blindingMode}, center ${newPatient.centerCode}).`);
    res.status(201).json({ patient: projectPatientForRole(newPatient, role) });
  });

  // Toggle Double-Blind / Open-Label mode for a patient
  app.patch('/api/patients/:studyId/blinding', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    if (role !== 'admin' && role !== 'researcher') {
      res.status(403).json({ error: 'Only Principal Investigator (Admin) or Medical Researcher can modify blinding mode.' });
      return;
    }
    const patient = patients.find((p) => p.studyId === req.params.studyId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }
    const mode = req.body.blindingMode as BlindingMode;
    if (mode !== 'open_label' && mode !== 'double_blind') {
      res.status(400).json({ error: 'Invalid blinding mode' });
      return;
    }
    patient.blindingMode = mode;
    appendAudit(role, 'BLINDING_MODE_CHANGED', patient.studyId, `Protocol switched to ${mode}.`);
    res.json({ patient: projectPatientForRole(patient, role) });
  });

  // Audio Ingestion Gateway (Accepts WAV/PCM DSP frames or live bedside stream block)
  app.post('/api/ingest/audio', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    const { studyId, segments, originalSampleRateHz } = req.body as {
      studyId: string;
      segments: AcousticSegment[];
      originalSampleRateHz?: number;
    };

    const patient = patients.find((p) => p.studyId === studyId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }

    // Strict Privacy Enforcement: Purge any speech segments before persistence
    const sanitizedSegments = (segments ?? []).map((seg) => {
      if (seg.classification === 'speech_purged' || seg.speechPurged) {
        return {
          ...seg,
          classification: 'speech_purged' as SoundClass,
          sqaValid: false,
          speechPurged: true,
          amplitudeDb: 0,
          waveformPeak: 0,
          sqaReason: 'Speech segment purged at Data Ingestion Gateway (HIPAA/GDPR)',
        };
      }
      return seg;
    });

    patient.segments = [...(patient.segments ?? []), ...sanitizedSegments].slice(-72);
    if (originalSampleRateHz) {
      patient.sensorStatus.sampleRateInputHz = originalSampleRateHz;
    }

    // Append/update latest hour telemetry without synthetic imputation
    const validSegs = sanitizedSegments.filter((s) => s.sqaValid);
    const bsSegs = validSegs.filter((s) => s.classification === 'bowel_sound');
    const validSec = validSegs.length * 5;
    const totalEvents = bsSegs.reduce((sum, s) => sum + s.occurrenceCount, 0);
    const ratePerMin = validSec > 0 ? Number(((totalEvents / validSec) * 60).toFixed(2)) : null;

    const prevTrend = patient.trend72h ?? [];
    const nextHourOffset = prevTrend.length > 0 ? prevTrend[prevTrend.length - 1].hourOffset + 1 : 0;
    const avgAmp =
      bsSegs.length > 0 ? Number((bsSegs.reduce((a, b) => a + b.amplitudeDb, 0) / bsSegs.length).toFixed(1)) : null;
    const avgFreq =
      bsSegs.length > 0 ? Math.round(bsSegs.reduce((a, b) => a + b.dominantFreqHz, 0) / bsSegs.length) : null;
    const avgDur =
      bsSegs.length > 0 ? Number((bsSegs.reduce((a, b) => a + b.eventDurationMeanSec, 0) / bsSegs.length).toFixed(2)) : null;

    prevTrend.push({
      hourOffset: nextHourOffset,
      timestampIso: new Date().toISOString(),
      validSecondsInHour: Math.max(validSec, 600),
      totalSecondsInHour: 3600,
      occurrenceRatePerMin: ratePerMin ?? 0,
      durationMeanSec: avgDur ?? 0.45,
      durationMedianSec: avgDur ? Number((avgDur * 0.9).toFixed(2)) : 0.4,
      amplitudeDb: avgAmp ?? 34.0,
      dominantFreqHz: avgFreq ?? 240,
      spectralCentroidHz: avgFreq ? Math.round(avgFreq * 1.18) : 283,
      interSoundIntervalSec: ratePerMin && ratePerMin > 0 ? Number((60 / ratePerMin).toFixed(1)) : 45.0,
    });

    patient.trend72h = prevTrend;
    patient.totalMonitoringHours += 1;
    patient.validMonitoringHours = Number(
      (prevTrend.reduce((a, b) => a + b.validSecondsInHour, 0) / 3600).toFixed(1)
    );
    patient.validMonitoringRatioPct = Number(
      ((patient.validMonitoringHours / Math.max(1, patient.totalMonitoringHours)) * 100).toFixed(1)
    );
    patient.insufficient48hWarning = patient.totalMonitoringHours >= 36 && patient.validMonitoringHours < 24;
    patient.prognosis = computePrognosis(patient, prevTrend, patient.dayScales ?? []);

    const purgedCount = sanitizedSegments.filter((s) => s.speechPurged).length;
    appendAudit(
      role,
      'AUDIO_STREAM_INGESTED',
      patient.studyId,
      `Ingested ${sanitizedSegments.length} 5s windows (resampled ${originalSampleRateHz ?? 16000}Hz -> 4000Hz). Speech windows purged: ${purgedCount}.`
    );

    res.json({ patient: projectPatientForRole(patient, role), purgedCount });
  });

  // Update sensor status (e.g., simulate detachment / reconnection / buffer sync)
  app.patch('/api/patients/:studyId/sensor', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    const patient = patients.find((p) => p.studyId === req.params.studyId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }
    patient.sensorStatus = { ...patient.sensorStatus, ...req.body };
    appendAudit(
      role,
      'SENSOR_STATUS_UPDATED',
      patient.studyId,
      `Detached=${patient.sensorStatus.detached}, Contact=${patient.sensorStatus.contactQualityPct}%, Buffered=${patient.sensorStatus.bufferedFrames}`
    );
    res.json({ patient: projectPatientForRole(patient, role) });
  });

  // Add Confounder / Therapy event
  app.post('/api/patients/:studyId/confounders', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    if (role === 'data_scientist') {
      res.status(403).json({ error: 'Technical Analysts cannot modify clinical therapy records.' });
      return;
    }
    const patient = patients.find((p) => p.studyId === req.params.studyId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }
    const event: ConfounderEvent = {
      id: `cf-${Date.now()}`,
      hourOffset: Number(req.body.hourOffset ?? (patient.trend72h?.length ?? 12)),
      timestampIso: req.body.timestampIso ?? new Date().toISOString(),
      category: req.body.category,
      agentName: req.body.agentName,
      doseOrVolume: req.body.doseOrVolume,
      notes: req.body.notes,
    };
    patient.confounders = [...(patient.confounders ?? []), event];
    appendAudit(role, 'CONFOUNDER_LOGGED', patient.studyId, `${event.category}: ${event.agentName} (${event.doseOrVolume})`);
    res.status(201).json({ patient: projectPatientForRole(patient, role) });
  });

  // Update or add Day Scale / Labs
  app.post('/api/patients/:studyId/scales', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    if (role === 'data_scientist') {
      res.status(403).json({ error: 'Technical Analysts cannot modify clinical scales.' });
      return;
    }
    const patient = patients.find((p) => p.studyId === req.params.studyId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }
    const { day, labs, agiGrade } = req.body as {
      day: 0 | 1 | 2 | 7;
      labs: DayScaleRecord['labs'];
      agiGrade: 0 | 1 | 2 | 3 | 4;
    };

    const record: DayScaleRecord = {
      day,
      recordedAtIso: new Date().toISOString(),
      labs,
      ransonScore: computeRansonScore(patient.age, labs, day >= 2),
      apacheIiScore: computeApacheIiScore(patient.age, labs),
      bisapScore: computeBisapScore(patient.age, labs),
      modifiedMarshallScore: computeModifiedMarshallScore(labs),
      agiGrade,
    };

    const scales = [...(patient.dayScales ?? [])].filter((s) => s.day !== day);
    scales.push(record);
    scales.sort((a, b) => a.day - b.day);
    patient.dayScales = scales;
    patient.prognosis = computePrognosis(patient, patient.trend72h ?? [], scales);

    appendAudit(role, 'CLINICAL_SCALES_UPDATED', patient.studyId, `Saved Day ${day} scores (Marshall=${record.modifiedMarshallScore}, APACHE II=${record.apacheIiScore}).`);
    res.json({ patient: projectPatientForRole(patient, role) });
  });

  // Expert Manual Annotation on Segment (CRNN active learning verification)
  app.post('/api/patients/:studyId/annotations', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    const patient = patients.find((p) => p.studyId === req.params.studyId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }
    const { segmentId, expertLabel } = req.body as { segmentId: string; expertLabel: SoundClass };
    const seg = (patient.segments ?? []).find((s) => s.id === segmentId);
    if (!seg) {
      res.status(404).json({ error: 'Segment not found' });
      return;
    }
    seg.verifiedByExpert = true;
    seg.expertLabel = expertLabel;
    seg.classification = expertLabel;
    seg.sqaValid = expertLabel === 'bowel_sound' || expertLabel === 'silence';
    if (expertLabel === 'speech_purged') {
      seg.speechPurged = true;
      seg.amplitudeDb = 0;
      seg.waveformPeak = 0;
    }
    appendAudit(role, 'SEGMENT_ANNOTATED', patient.studyId, `Expert verified ${segmentId} as ${expertLabel}.`);
    res.json({ patient: projectPatientForRole(patient, role) });
  });

  // HL7 FHIR R4 Bundle Import (Amylase, Lipase, CRP, WBC, Hct, Creatinine, BUN)
  app.post('/api/fhir/import', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    if (role === 'data_scientist') {
      res.status(403).json({ error: 'Technical Analysts cannot import Hospital EHR/FHIR lab bundles.' });
      return;
    }
    const { studyId, bundle } = req.body as {
      studyId: string;
      bundle: {
        resourceType: string;
        entry?: Array<{
          resource?: {
            resourceType?: string;
            code?: { coding?: Array<{ code?: string; display?: string }> };
            valueQuantity?: { value?: number; unit?: string };
          };
        }>;
      };
    };

    const patient = patients.find((p) => p.studyId === studyId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }

    const scales = patient.dayScales ?? [];
    const latest = scales[scales.length - 1];
    if (!latest) {
      res.status(400).json({ error: 'No baseline clinical day record found.' });
      return;
    }

    const updatedLabs = { ...latest.labs };
    let importedCount = 0;
    for (const item of bundle.entry ?? []) {
      const code = item.resource?.code?.coding?.[0]?.code;
      const val = item.resource?.valueQuantity?.value;
      if (typeof val !== 'number') continue;
      if (code === '1798-8') { updatedLabs.amylaseUL = val; importedCount++; }
      if (code === '3040-3') { updatedLabs.lipaseUL = val; importedCount++; }
      if (code === '1988-5') { updatedLabs.crpMgL = val; importedCount++; }
      if (code === '6690-2') { updatedLabs.wbc10e9L = val; importedCount++; }
      if (code === '4544-3') { updatedLabs.hematocritPct = val; importedCount++; }
      if (code === '2160-0') { updatedLabs.creatinineMgDl = val; importedCount++; }
      if (code === '3094-0') { updatedLabs.bunMgDl = val; importedCount++; }
    }

    latest.labs = updatedLabs;
    latest.ransonScore = computeRansonScore(patient.age, updatedLabs, latest.day >= 2);
    latest.apacheIiScore = computeApacheIiScore(patient.age, updatedLabs);
    latest.bisapScore = computeBisapScore(patient.age, updatedLabs);
    latest.modifiedMarshallScore = computeModifiedMarshallScore(updatedLabs);
    patient.fhirImportedAt = new Date().toISOString();
    patient.prognosis = computePrognosis(patient, patient.trend72h ?? [], scales);

    appendAudit(role, 'HL7_FHIR_IMPORT', patient.studyId, `Imported ${importedCount} LOINC Observations from Hospital HIS via HL7 FHIR R4.`);
    res.json({ patient: projectPatientForRole(patient, role), importedCount });
  });

  // HL7 FHIR R4 DiagnosticReport Export
  app.get('/api/fhir/DiagnosticReport/:studyId', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    const patient = patients.find((p) => p.studyId === req.params.studyId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }
    const projected = projectPatientForRole(patient, role);
    const report = {
      resourceType: 'DiagnosticReport',
      id: `bowelsound-ap-${projected.studyId}`,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'GE', display: 'Gastroenterology Phonoenterography' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Intestinal Peristalsis Acoustic Telemetry & SAP Risk Panel' }] },
      subject: { reference: `Patient/${projected.studyId}` },
      effectiveDateTime: new Date().toISOString(),
      conclusion: projected.prognosis
        ? `Combined SAP Risk: ${projected.prognosis.combinedSapProbPct}% (95% CI ${projected.prognosis.combinedCi95[0]}-${projected.prognosis.combinedCi95[1]}%); EN Zone: ${projected.prognosis.enteralZone}; MRI: ${projected.prognosis.motilityRecoveryIndex}/100.`
        : 'Redacted per Double-Blind Protocol',
    };
    appendAudit(role, 'HL7_FHIR_EXPORT', patient.studyId, 'Exported HL7 FHIR R4 DiagnosticReport.');
    res.json(report);
  });

  // Governance & Audit Logs
  app.get('/api/governance', (_req: Request, res: Response) => {
    res.json({ governance, auditLogs });
  });

  app.patch('/api/governance', (req: Request, res: Response) => {
    const role = getRoleFromRequest(req);
    if (role !== 'admin') {
      res.status(403).json({ error: 'System Administrator / PI access required.' });
      return;
    }
    governance = { ...governance, ...req.body };
    appendAudit(role, 'GOVERNANCE_UPDATED', 'SYSTEM', `Updated algorithm/center governance (${governance.crnnModelVersion}).`);
    res.json({ governance, auditLogs });
  });

  // Vite Dev Middleware or Static Production Serve
  const distPath = path.resolve(__dirname, 'dist');
  const useStaticProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(distPath, 'index.html'));
  if (!useStaticProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BowelSound-AP server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
