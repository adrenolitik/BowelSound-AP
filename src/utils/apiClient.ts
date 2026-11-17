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
} from '../types/clinical';
import {
  computeApacheIiScore,
  computeBisapScore,
  computeModifiedMarshallScore,
  computePrognosis,
  computeRansonScore,
  createInitialPatients,
} from './clinicalScoring';

const ROLE_NAMES: Record<UserRole, string> = {
  clinician: 'Dr. S. Vance (ICU / HPB Surgery)',
  researcher: 'M. Lindqvist (Clinical Trial Coordinator)',
  data_scientist: 'A. Petrov (ML & DSP Analyst)',
  admin: 'Prof. R. Kapoor (PI / System Admin)',
};

let fallbackPatients: PatientRecord[] | null = null;
let fallbackGovernance: GovernanceConfig = {
  crnnModelVersion: 'CRNN-5L-BiGRU-v2.4.1',
  crnnF1Validated: 0.86,
  activeCenters: ['CTR-01-HPB', 'CTR-02-SURG', 'CTR-03-GASTRO'],
  globalBlindingDefault: 'open_label',
  strictSpeechPurge: true,
  noSyntheticImputation: true,
  tlsAndAesStatus: 'TLS 1.3 In-Transit · AES-256 At-Rest · PII Segregated',
};
let fallbackAuditLogs: AuditLogEntry[] = [
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

function ensurePatients(): PatientRecord[] {
  if (!fallbackPatients) {
    fallbackPatients = createInitialPatients();
  }
  return fallbackPatients;
}

function appendAudit(actorRole: UserRole, action: string, targetStudyId: string, details: string) {
  fallbackAuditLogs.unshift({
    id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestampIso: new Date().toISOString(),
    actorRole,
    actorName: ROLE_NAMES[actorRole] ?? actorRole,
    action,
    targetStudyId,
    details,
  });
}

function projectPatient(patient: PatientRecord, role: UserRole): PatientRecord {
  const clone: PatientRecord = JSON.parse(JSON.stringify(patient));
  if (role === 'data_scientist') {
    delete clone.pii;
  }
  if (clone.blindingMode === 'double_blind') {
    if (role === 'clinician') {
      delete clone.trend72h;
      delete clone.segments;
      delete clone.prognosis;
      clone.blindedRedactionNotice =
        'DOUBLE-BLIND PROTOCOL ACTIVE: Acoustic biomarkers, spectrograms, and ML predictions are withheld from treating clinicians. Technical sensor telemetry remains visible.';
    } else if (role === 'data_scientist') {
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

function jsonResp(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function handleLocalApi(url: string, init?: RequestInit): Response {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const roleHeader = headers['x-user-role'] ?? 'clinician';
  const role: UserRole =
    roleHeader === 'researcher' || roleHeader === 'data_scientist' || roleHeader === 'admin'
      ? roleHeader
      : 'clinician';
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const list = ensurePatients();

  if (url === '/api/patients' && method === 'GET') {
    return jsonResp({ patients: list.map((p) => projectPatient(p, role)), role });
  }

  if (url === '/api/patients' && method === 'POST') {
    if (role === 'data_scientist') {
      return jsonResp({ error: 'Data Scientists cannot enroll patients with PII.' }, 403);
    }
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
    const created: PatientRecord = {
      studyId,
      centerCode: body.centerCode ?? 'CTR-01-HPB',
      pii: body.pii ?? { fullName: 'Anonymous Enrollment', mrn: `MRN-${Math.floor(100000 + Math.random() * 899999)}`, bedNumber: 'WARD-08' },
      age,
      sex: body.sex ?? 'M',
      bmi: Number(body.bmi ?? 26.5),
      etiology: body.etiology ?? 'Biliary',
      admissionIso,
      hoursSinceOnsetAtAdmission: Number(body.hoursSinceOnsetAtAdmission ?? 18),
      blindingMode: body.blindingMode ?? fallbackGovernance.globalBlindingDefault,
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
    list.unshift(created);
    appendAudit(role, 'PATIENT_ENROLLED', studyId, `Enrolled eCRF (${created.blindingMode}).`);
    return jsonResp({ patient: projectPatient(created, role) }, 201);
  }

  if (url === '/api/governance') {
    if (method === 'PATCH') {
      if (role !== 'admin') return jsonResp({ error: 'System Administrator / PI access required.' }, 403);
      fallbackGovernance = { ...fallbackGovernance, ...body };
      appendAudit(role, 'GOVERNANCE_UPDATED', 'SYSTEM', `Updated governance (${fallbackGovernance.crnnModelVersion}).`);
    }
    return jsonResp({ governance: fallbackGovernance, auditLogs: fallbackAuditLogs });
  }

  if (url === '/api/ingest/audio' && method === 'POST') {
    const patient = list.find((p) => p.studyId === body.studyId);
    if (!patient) return jsonResp({ error: 'Patient not found' }, 404);
    const sanitized: AcousticSegment[] = (body.segments ?? []).map((seg: AcousticSegment) =>
      seg.classification === 'speech_purged' || seg.speechPurged
        ? { ...seg, classification: 'speech_purged' as SoundClass, sqaValid: false, speechPurged: true, amplitudeDb: 0, waveformPeak: 0 }
        : seg
    );
    patient.segments = [...(patient.segments ?? []), ...sanitized].slice(-72);
    const validSegs = sanitized.filter((s) => s.sqaValid);
    const bsSegs = validSegs.filter((s) => s.classification === 'bowel_sound');
    const validSec = validSegs.length * 5;
    const totalEvents = bsSegs.reduce((sum, s) => sum + s.occurrenceCount, 0);
    const rate = validSec > 0 ? Number(((totalEvents / validSec) * 60).toFixed(2)) : 0;
    const trend = patient.trend72h ?? [];
    const nextHour = trend.length > 0 ? trend[trend.length - 1].hourOffset + 1 : 0;
    trend.push({
      hourOffset: nextHour,
      timestampIso: new Date().toISOString(),
      validSecondsInHour: Math.max(validSec, 600),
      totalSecondsInHour: 3600,
      occurrenceRatePerMin: rate,
      durationMeanSec: 0.55,
      durationMedianSec: 0.48,
      amplitudeDb: 50.2,
      dominantFreqHz: 270,
      spectralCentroidHz: 318,
      interSoundIntervalSec: rate > 0 ? Number((60 / rate).toFixed(1)) : 45.0,
    });
    patient.trend72h = trend;
    patient.totalMonitoringHours += 1;
    patient.validMonitoringHours = Number((trend.reduce((a, b) => a + b.validSecondsInHour, 0) / 3600).toFixed(1));
    patient.validMonitoringRatioPct = Number(((patient.validMonitoringHours / Math.max(1, patient.totalMonitoringHours)) * 100).toFixed(1));
    patient.prognosis = computePrognosis(patient, trend, patient.dayScales ?? []);
    const purgedCount = sanitized.filter((s) => s.speechPurged).length;
    appendAudit(role, 'AUDIO_STREAM_INGESTED', patient.studyId, `Ingested ${sanitized.length} windows (${purgedCount} speech purged).`);
    return jsonResp({ patient: projectPatient(patient, role), purgedCount });
  }

  if (url === '/api/fhir/import' && method === 'POST') {
    const patient = list.find((p) => p.studyId === body.studyId);
    if (!patient) return jsonResp({ error: 'Patient not found' }, 404);
    const scales = patient.dayScales ?? [];
    const latest = scales[scales.length - 1];
    if (latest && body.bundle?.entry) {
      let importedCount = 0;
      const labs = { ...latest.labs };
      for (const item of body.bundle.entry) {
        const code = item.resource?.code?.coding?.[0]?.code;
        const val = item.resource?.valueQuantity?.value;
        if (typeof val !== 'number') continue;
        if (code === '1798-8') { labs.amylaseUL = val; importedCount++; }
        if (code === '3040-3') { labs.lipaseUL = val; importedCount++; }
        if (code === '1988-5') { labs.crpMgL = val; importedCount++; }
        if (code === '6690-2') { labs.wbc10e9L = val; importedCount++; }
        if (code === '4544-3') { labs.hematocritPct = val; importedCount++; }
        if (code === '2160-0') { labs.creatinineMgDl = val; importedCount++; }
        if (code === '3094-0') { labs.bunMgDl = val; importedCount++; }
      }
      latest.labs = labs;
      latest.ransonScore = computeRansonScore(patient.age, labs, latest.day >= 2);
      latest.apacheIiScore = computeApacheIiScore(patient.age, labs);
      latest.bisapScore = computeBisapScore(patient.age, labs);
      latest.modifiedMarshallScore = computeModifiedMarshallScore(labs);
      patient.fhirImportedAt = new Date().toISOString();
      patient.prognosis = computePrognosis(patient, patient.trend72h ?? [], scales);
      appendAudit(role, 'HL7_FHIR_IMPORT', patient.studyId, `Imported ${importedCount} FHIR LOINC observations.`);
      return jsonResp({ patient: projectPatient(patient, role), importedCount });
    }
    return jsonResp({ patient: projectPatient(patient, role), importedCount: 0 });
  }

  const fhirMatch = url.match(/^\/api\/fhir\/DiagnosticReport\/([^/]+)$/);
  if (fhirMatch) {
    const patient = list.find((p) => p.studyId === fhirMatch[1]);
    if (!patient) return jsonResp({ error: 'Patient not found' }, 404);
    const projected = projectPatient(patient, role);
    return jsonResp({
      resourceType: 'DiagnosticReport',
      id: `bowelsound-ap-${projected.studyId}`,
      status: 'final',
      subject: { reference: `Patient/${projected.studyId}` },
      effectiveDateTime: new Date().toISOString(),
      conclusion: projected.prognosis
        ? `Combined SAP Risk: ${projected.prognosis.combinedSapProbPct}%; EN Zone: ${projected.prognosis.enteralZone}; MRI: ${projected.prognosis.motilityRecoveryIndex}/100.`
        : 'Redacted per Double-Blind Protocol',
    });
  }

  const patActionMatch = url.match(/^\/api\/patients\/([^/]+)\/(blinding|sensor|confounders|scales|annotations)$/);
  if (patActionMatch) {
    const [, studyId, action] = patActionMatch;
    const patient = list.find((p) => p.studyId === studyId);
    if (!patient) return jsonResp({ error: 'Patient not found' }, 404);

    if (action === 'blinding') {
      if (role !== 'admin' && role !== 'researcher') {
        return jsonResp({ error: 'Only Admin or Researcher can change blinding mode.' }, 403);
      }
      patient.blindingMode = body.blindingMode as BlindingMode;
      appendAudit(role, 'BLINDING_MODE_CHANGED', studyId, `Switched to ${patient.blindingMode}.`);
    } else if (action === 'sensor') {
      patient.sensorStatus = { ...patient.sensorStatus, ...body };
      appendAudit(role, 'SENSOR_STATUS_UPDATED', studyId, `Detached=${patient.sensorStatus.detached}.`);
    } else if (action === 'confounders') {
      const event: ConfounderEvent = {
        id: `cf-${Date.now()}`,
        hourOffset: Number(body.hourOffset ?? 12),
        timestampIso: new Date().toISOString(),
        category: body.category,
        agentName: body.agentName,
        doseOrVolume: body.doseOrVolume,
        notes: body.notes,
      };
      patient.confounders = [...(patient.confounders ?? []), event];
      appendAudit(role, 'CONFOUNDER_LOGGED', studyId, `${event.agentName} (${event.doseOrVolume})`);
      return jsonResp({ patient: projectPatient(patient, role) }, 201);
    } else if (action === 'scales') {
      const record: DayScaleRecord = {
        day: body.day,
        recordedAtIso: new Date().toISOString(),
        labs: body.labs,
        ransonScore: computeRansonScore(patient.age, body.labs, body.day >= 2),
        apacheIiScore: computeApacheIiScore(patient.age, body.labs),
        bisapScore: computeBisapScore(patient.age, body.labs),
        modifiedMarshallScore: computeModifiedMarshallScore(body.labs),
        agiGrade: body.agiGrade,
      };
      const scales = [...(patient.dayScales ?? [])].filter((s) => s.day !== body.day);
      scales.push(record);
      scales.sort((a, b) => a.day - b.day);
      patient.dayScales = scales;
      patient.prognosis = computePrognosis(patient, patient.trend72h ?? [], scales);
      appendAudit(role, 'CLINICAL_SCALES_UPDATED', studyId, `Saved Day ${body.day} scores.`);
    } else if (action === 'annotations') {
      const seg = (patient.segments ?? []).find((s) => s.id === body.segmentId);
      if (seg) {
        seg.verifiedByExpert = true;
        seg.expertLabel = body.expertLabel;
        seg.classification = body.expertLabel;
      }
      appendAudit(role, 'SEGMENT_ANNOTATED', studyId, `Verified ${body.segmentId} as ${body.expertLabel}.`);
    }
    return jsonResp({ patient: projectPatient(patient, role) });
  }

  return jsonResp({ error: 'Not found' }, 404);
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init);
    if (res.status === 404 && url.startsWith('/api/')) {
      return handleLocalApi(url, init);
    }
    return res;
  } catch {
    if (url.startsWith('/api/')) {
      return handleLocalApi(url, init);
    }
    throw new Error('Network error');
  }
}
