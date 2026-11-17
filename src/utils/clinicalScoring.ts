import type {
  AcousticSegment,
  AcousticTrendPoint,
  ConfounderEvent,
  DayScaleRecord,
  LabMarkers,
  ModelBenchmark,
  PatientRecord,
  PrognosticOutput,
  SoundClass,
} from '../types/clinical.ts';

export function computeRansonScore(age: number, labs: LabMarkers, is48hOrLater: boolean): number {
  let score = 0;
  // Admission criteria (non-gallstone baseline)
  if (age > 55) score++;
  if (labs.wbc10e9L > 16) score++;
  if (labs.glucoseMgDl > 200) score++;
  if (labs.ldhUL > 350) score++;
  if (labs.astUL > 250) score++;

  if (is48hOrLater) {
    if (labs.hematocritPct < 36) score++; // proxy for Hct drop > 10%
    if (labs.bunMgDl > 23) score++; // BUN rise proxy
    if (labs.calciumMgDl < 8.0) score++;
    if (labs.pao2Fio2 < 300) score++; // PaO2 < 60 mmHg proxy
    if (labs.baseDeficitMeqL > 4) score++;
  }
  return Math.min(11, score);
}

export function computeBisapScore(age: number, labs: LabMarkers): number {
  let score = 0;
  if (labs.bunMgDl > 25) score++;
  if (labs.impairedMentalStatus || labs.gcs < 15) score++;
  // SIRS >= 2
  let sirs = 0;
  if (labs.tempC > 38 || labs.tempC < 36) sirs++;
  if (labs.heartRateBpm > 90) sirs++;
  if (labs.respRateBpm > 20) sirs++;
  if (labs.wbc10e9L > 12 || labs.wbc10e9L < 4) sirs++;
  if (sirs >= 2) score++;
  if (age > 60) score++;
  if (labs.pleuralEffusion) score++;
  return score;
}

export function computeModifiedMarshallScore(labs: LabMarkers): number {
  let resp = 0;
  if (labs.pao2Fio2 <= 100) resp = 4;
  else if (labs.pao2Fio2 <= 200) resp = 3;
  else if (labs.pao2Fio2 <= 300) resp = 2;
  else if (labs.pao2Fio2 <= 400) resp = 1;

  let renal = 0;
  if (labs.creatinineMgDl >= 5.0) renal = 4;
  else if (labs.creatinineMgDl >= 3.6) renal = 3;
  else if (labs.creatinineMgDl >= 2.0) renal = 2;
  else if (labs.creatinineMgDl >= 1.4) renal = 1;

  let cardio = 0;
  if (labs.sbpMmHg < 90) {
    if (labs.arterialPh < 7.2) cardio = 4;
    else if (labs.arterialPh < 7.3) cardio = 3;
    else cardio = 2;
  }

  return resp + renal + cardio;
}

export function computeApacheIiScore(age: number, labs: LabMarkers): number {
  let pts = 0;
  // Temperature
  if (labs.tempC >= 41 || labs.tempC <= 29.9) pts += 4;
  else if (labs.tempC >= 39 || labs.tempC <= 31.9) pts += 3;
  else if (labs.tempC <= 33.9) pts += 2;
  else if (labs.tempC >= 38.5 || labs.tempC <= 35.9) pts += 1;

  // MAP approximation via SBP
  if (labs.sbpMmHg < 70) pts += 4;
  else if (labs.sbpMmHg < 90) pts += 2;
  else if (labs.sbpMmHg >= 150) pts += 2;

  // Heart rate
  if (labs.heartRateBpm >= 180 || labs.heartRateBpm <= 39) pts += 4;
  else if (labs.heartRateBpm >= 140 || labs.heartRateBpm <= 54) pts += 3;
  else if (labs.heartRateBpm >= 110 || labs.heartRateBpm <= 69) pts += 2;

  // Resp rate
  if (labs.respRateBpm >= 50 || labs.respRateBpm <= 5) pts += 4;
  else if (labs.respRateBpm >= 35) pts += 3;
  else if (labs.respRateBpm >= 25 || labs.respRateBpm <= 11) pts += 1;

  // Oxygenation
  if (labs.pao2Fio2 < 200) pts += 3;
  else if (labs.pao2Fio2 < 300) pts += 2;

  // Arterial pH
  if (labs.arterialPh >= 7.7 || labs.arterialPh < 7.15) pts += 4;
  else if (labs.arterialPh >= 7.6 || labs.arterialPh < 7.25) pts += 3;
  else if (labs.arterialPh < 7.33) pts += 2;

  // Sodium
  if (labs.sodiumMeqL >= 180 || labs.sodiumMeqL <= 110) pts += 4;
  else if (labs.sodiumMeqL >= 160 || labs.sodiumMeqL <= 119) pts += 3;
  else if (labs.sodiumMeqL >= 150) pts += 1;

  // Potassium
  if (labs.potassiumMeqL >= 7 || labs.potassiumMeqL < 2.5) pts += 4;
  else if (labs.potassiumMeqL >= 6) pts += 3;
  else if (labs.potassiumMeqL >= 5.5 || labs.potassiumMeqL < 3) pts += 1;

  // Creatinine (acute renal failure doubles)
  let crPts = 0;
  if (labs.creatinineMgDl >= 3.5) crPts = 4;
  else if (labs.creatinineMgDl >= 2.0) crPts = 3;
  else if (labs.creatinineMgDl >= 1.5) crPts = 2;
  pts += crPts * 2;

  // Hematocrit
  if (labs.hematocritPct >= 60 || labs.hematocritPct < 20) pts += 4;
  else if (labs.hematocritPct >= 50 || labs.hematocritPct < 30) pts += 2;
  else if (labs.hematocritPct >= 46) pts += 1;

  // WBC
  if (labs.wbc10e9L >= 40 || labs.wbc10e9L < 1) pts += 4;
  else if (labs.wbc10e9L >= 20 || labs.wbc10e9L < 3) pts += 2;
  else if (labs.wbc10e9L >= 15) pts += 1;

  // GCS
  pts += Math.max(0, 15 - labs.gcs);

  // Age
  if (age >= 75) pts += 6;
  else if (age >= 65) pts += 5;
  else if (age >= 55) pts += 3;
  else if (age >= 45) pts += 2;

  return pts;
}

export function adjustAmplitudeForBmi(rawDb: number, bmi: number, applyCorrection: boolean): number {
  if (!applyCorrection) return Number(rawDb.toFixed(1));
  // Adipose attenuation compensation: +0.28 dB per BMI unit above 24.0 kg/m2
  const delta = Math.max(0, bmi - 24) * 0.28;
  return Number((rawDb + delta).toFixed(1));
}

export function computePrognosis(
  patient: Pick<PatientRecord, 'age' | 'bmi'>,
  trend: AcousticTrendPoint[],
  dayScales: DayScaleRecord[]
): PrognosticOutput {
  const validPoints = trend.filter((p) => p.occurrenceRatePerMin !== null && p.validSecondsInHour > 0);
  const recentWindow = validPoints.slice(-6);
  const earlierWindow = validPoints.slice(-12, -6);

  const avgRecentRate =
    recentWindow.length > 0
      ? recentWindow.reduce((acc, p) => acc + (p.occurrenceRatePerMin ?? 0), 0) / recentWindow.length
      : 0;
  const avgEarlierRate =
    earlierWindow.length > 0
      ? earlierWindow.reduce((acc, p) => acc + (p.occurrenceRatePerMin ?? 0), 0) / earlierWindow.length
      : avgRecentRate;

  const avgRecentIsi =
    recentWindow.length > 0
      ? recentWindow.reduce((acc, p) => acc + (p.interSoundIntervalSec ?? 25), 0) / recentWindow.length
      : 30;
  const avgEarlierIsi =
    earlierWindow.length > 0
      ? earlierWindow.reduce((acc, p) => acc + (p.interSoundIntervalSec ?? 25), 0) / earlierWindow.length
      : avgRecentIsi;

  // Check 2 consecutive hours of critical silence (< 0.8 events/min across valid hours)
  let silentConsecutive = 0;
  for (let i = validPoints.length - 1; i >= 0; i--) {
    if ((validPoints[i].occurrenceRatePerMin ?? 0) < 0.8) {
      silentConsecutive++;
    } else {
      break;
    }
  }
  const silentAbdomenAlert = silentConsecutive >= 2;

  // Motility Recovery Index (0 - 100)
  const rateLevelScore = Math.min(45, (avgRecentRate / 8.5) * 45);
  const rateTrendDelta = avgRecentRate - avgEarlierRate;
  const trendScore = Math.max(0, Math.min(30, 15 + rateTrendDelta * 5.5));
  const isiReduction = avgEarlierIsi - avgRecentIsi;
  const isiScore = Math.max(0, Math.min(25, (25 - Math.min(25, avgRecentIsi)) * 0.7 + isiReduction * 0.8));
  const motilityRecoveryIndex = Math.round(Math.max(4, Math.min(98, rateLevelScore + trendScore + isiScore)));

  // BS-only Model SAP Risk
  const bsLogit =
    1.15 -
    0.29 * avgRecentRate -
    0.45 * rateTrendDelta +
    (silentAbdomenAlert ? 1.05 : 0) +
    0.03 * Math.max(0, avgRecentIsi - 18);
  const bsOnlySapProbPct = Number((100 / (1 + Math.exp(-bsLogit))).toFixed(1));
  const bsHalfWidth = Number((5.2 + (validPoints.length < 18 ? 3.8 : 0)).toFixed(1));
  const bsOnlyCi95: [number, number] = [
    Number(Math.max(1.2, bsOnlySapProbPct - bsHalfWidth).toFixed(1)),
    Number(Math.min(98.5, bsOnlySapProbPct + bsHalfWidth).toFixed(1)),
  ];

  // Latest Day Scale
  const latestScale = dayScales[dayScales.length - 1];
  const marshall = latestScale?.modifiedMarshallScore ?? 0;
  const apache = latestScale?.apacheIiScore ?? 6;
  const bisap = latestScale?.bisapScore ?? 1;
  const crp = latestScale?.labs.crpMgL ?? 45;
  const agi = latestScale?.agiGrade ?? 1;

  const clinicalLogit =
    -2.9 + 0.55 * marshall + 0.14 * apache + 0.35 * bisap + 0.006 * crp + 0.4 * agi + 0.015 * Math.max(0, patient.age - 55);
  const clinicalScalesSapProbPct = Number((100 / (1 + Math.exp(-clinicalLogit))).toFixed(1));

  const combinedSapProbPct = Number((0.46 * bsOnlySapProbPct + 0.54 * clinicalScalesSapProbPct).toFixed(1));
  const combHalfWidth = Number((3.4 + (validPoints.length < 18 ? 2.6 : 0)).toFixed(1));
  const combinedCi95: [number, number] = [
    Number(Math.max(1.0, combinedSapProbPct - combHalfWidth).toFixed(1)),
    Number(Math.min(98.8, combinedSapProbPct + combHalfWidth).toFixed(1)),
  ];

  let enteralZone: 'ileus' | 'transitional' | 'recovery' = 'transitional';
  let enteralRecommendation =
    'Transitional motility pattern. Continue trophic/low-rate enteral nutrition (10–20 mL/h) with 6-hour acoustic reassessment.';
  if (motilityRecoveryIndex < 35 || silentAbdomenAlert) {
    enteralZone = 'ileus';
    enteralRecommendation =
      'Ileus / High Intolerance Risk. Defer EN escalation; prioritize goal-directed resuscitation, opioid-sparing analgesia, and prokinetic evaluation.';
  } else if (motilityRecoveryIndex >= 64 && avgRecentRate >= 4.2) {
    enteralZone = 'recovery';
    enteralRecommendation =
      'Motility Recovery Confirmed. Recommended to initiate or advance polymeric/semi-elemental enteral nutrition toward target caloric rate.';
  }

  const predictedLosDays = Math.round(6 + (combinedSapProbPct / 100) * 19 + marshall * 1.4);
  const infectedNecrosisSepsisRiskPct = Number(Math.min(78, Math.max(2.5, combinedSapProbPct * 0.58 + (crp > 150 ? 9 : 0))).toFixed(1));
  const mortality90DayRiskPct = Number(Math.min(42, Math.max(0.8, combinedSapProbPct * 0.24 + (marshall >= 4 ? 6.5 : 0))).toFixed(1));

  return {
    bsOnlySapProbPct,
    bsOnlyCi95,
    combinedSapProbPct,
    combinedCi95,
    clinicalScalesSapProbPct,
    motilityRecoveryIndex,
    enteralZone,
    enteralRecommendation,
    predictedLosDays,
    infectedNecrosisSepsisRiskPct,
    mortality90DayRiskPct,
    silentAbdomenAlert,
    silentAbdomenHours: silentConsecutive,
  };
}

export const TRIPOD_MODEL_BENCHMARKS: ModelBenchmark[] = [
  {
    id: 'm-comb-gb',
    name: 'Combined Clinico-Acoustic Gradient Boosting',
    family: 'Gradient Boosting',
    inputScope: 'Combined Clinico-Acoustic',
    f1EventDetection: 0.86,
    rocAucSap: 0.91,
    sensitivity: 0.88,
    specificity: 0.85,
    brierScore: 0.094,
    calibrationSlope: 0.97,
    tripodAiCompliant: true,
  },
  {
    id: 'm-comb-rf',
    name: 'Combined Random Forest Ensemble',
    family: 'Random Forest',
    inputScope: 'Combined Clinico-Acoustic',
    f1EventDetection: 0.84,
    rocAucSap: 0.88,
    sensitivity: 0.84,
    specificity: 0.83,
    brierScore: 0.112,
    calibrationSlope: 0.94,
    tripodAiCompliant: true,
  },
  {
    id: 'm-bs-gb',
    name: 'Autonomous Acoustic Model (BS-only)',
    family: 'Gradient Boosting',
    inputScope: 'BS-only',
    f1EventDetection: 0.83,
    rocAucSap: 0.84,
    sensitivity: 0.81,
    specificity: 0.80,
    brierScore: 0.129,
    calibrationSlope: 0.92,
    tripodAiCompliant: true,
  },
  {
    id: 'm-bs-svm',
    name: 'BS-only RBF Support Vector Machine',
    family: 'SVM',
    inputScope: 'BS-only',
    f1EventDetection: 0.82,
    rocAucSap: 0.81,
    sensitivity: 0.78,
    specificity: 0.79,
    brierScore: 0.146,
    calibrationSlope: 0.89,
    tripodAiCompliant: true,
  },
  {
    id: 'm-clin-lr',
    name: 'Baseline Clinical Scales Logistic Regression',
    family: 'Logistic Regression',
    inputScope: 'Clinical Scales Only',
    f1EventDetection: 0.81,
    rocAucSap: 0.76,
    sensitivity: 0.72,
    specificity: 0.75,
    brierScore: 0.178,
    calibrationSlope: 0.85,
    tripodAiCompliant: true,
  },
];

function generateSegments(
  baseRatePerMin: number,
  seedOffset: number,
  includeSilentTail: boolean
): AcousticSegment[] {
  const segments: AcousticSegment[] = [];
  const totalWindows = 36; // 3-minute high-resolution window (36 x 5s)
  for (let i = 0; i < totalWindows; i++) {
    const pseudo = Math.abs(Math.sin((i + 1) * 12.9898 + seedOffset * 78.233));
    const frac = pseudo - Math.floor(pseudo);

    let classification: SoundClass = 'bowel_sound';
    let sqaValid = true;
    let sqaReason: string | undefined;
    let speechPurged = false;

    if (includeSilentTail && i >= 26) {
      classification = i % 5 === 0 ? 'breathing' : 'silence';
      if (classification === 'breathing') {
        sqaValid = false;
        sqaReason = 'Respiratory artifact (>450 ms cyclic chest wall energy)';
      }
    } else if (frac > 0.93) {
      classification = 'speech_purged';
      sqaValid = false;
      sqaReason = 'Human speech detected & immediately purged (HIPAA/GDPR privacy filter)';
      speechPurged = true;
    } else if (frac > 0.86) {
      classification = 'friction';
      sqaValid = false;
      sqaReason = 'Clothing/linen friction broadband artifact';
    } else if (frac > 0.81) {
      classification = 'breathing';
      sqaValid = false;
      sqaReason = 'Respiratory artifact';
    } else if (frac > 0.77) {
      classification = 'cough';
      sqaValid = false;
      sqaReason = 'Transient high-SPL cough burst rejected';
    } else if (frac < 0.14) {
      classification = 'silence';
    }

    const isBs = classification === 'bowel_sound';
    const occ = isBs ? Math.max(1, Math.round((baseRatePerMin / 12) * (0.7 + frac))) : 0;
    const dominantFreqHz = isBs
      ? Math.round(215 + frac * 310)
      : classification === 'breathing'
      ? 135
      : classification === 'friction'
      ? 740
      : 95;
    const amplitudeDb = speechPurged
      ? 0
      : isBs
      ? Number((46 + frac * 18).toFixed(1))
      : classification === 'silence'
      ? 24.5
      : Number((52 + frac * 14).toFixed(1));

    segments.push({
      id: `seg-${seedOffset}-${i}`,
      windowIndex: i,
      startSec: i * 5,
      durationSec: 5,
      classification,
      confidence: Number((0.83 + (frac % 0.15)).toFixed(2)),
      sqaValid,
      sqaReason,
      speechPurged,
      occurrenceCount: occ,
      eventDurationMeanSec: isBs ? Number((0.42 + frac * 0.55).toFixed(2)) : 0,
      amplitudeDb,
      dominantFreqHz,
      spectralCentroidHz: Math.round(dominantFreqHz * 1.18),
      interSoundIntervalSec: isBs ? Number((60 / Math.max(1.1, baseRatePerMin)).toFixed(1)) : null,
      mfccSummary: [
        Number((-14.2 + frac * 6).toFixed(2)),
        Number((8.4 - frac * 3).toFixed(2)),
        Number((3.1 + frac * 2.5).toFixed(2)),
        Number((-1.9 + frac * 1.4).toFixed(2)),
      ],
      waveformPeak: speechPurged ? 0.02 : isBs ? Number((0.35 + frac * 0.55).toFixed(2)) : 0.12,
    });
  }
  return segments;
}

function build72hTrend(
  hours: number,
  pattern: 'deteriorating_ileus' | 'recovering' | 'sparse_warning',
  admissionIso: string
): AcousticTrendPoint[] {
  const baseTime = new Date(admissionIso).getTime();
  const points: AcousticTrendPoint[] = [];

  for (let h = 0; h < hours; h++) {
    const ts = new Date(baseTime + h * 3600_000).toISOString();
    const wave = Math.sin(h * 0.45) * 0.45;

    // Simulate realistic sensor gaps / motion artifacts
    let validSec = 3180 + Math.round(Math.cos(h * 0.7) * 320);
    if (pattern === 'sparse_warning' && h % 2 === 1) {
      validSec = 420; // Low valid time -> triggers <24h/48h warning!
    }
    if (pattern === 'sparse_warning' && h >= 18 && h <= 24) {
      validSec = 0; // Complete detachment gap (strictly null metrics, no imputation!)
    }

    if (validSec === 0) {
      points.push({
        hourOffset: h,
        timestampIso: ts,
        validSecondsInHour: 0,
        totalSecondsInHour: 3600,
        occurrenceRatePerMin: null,
        durationMeanSec: null,
        durationMedianSec: null,
        amplitudeDb: null,
        dominantFreqHz: null,
        spectralCentroidHz: null,
        interSoundIntervalSec: null,
      });
      continue;
    }

    let rate = 4.5;
    let amp = 52;
    let freq = 290;
    let durMean = 0.68;

    if (pattern === 'deteriorating_ileus') {
      // Progressive drop into 4 hours of Silent Abdomen (< 0.8/min)
      rate = Math.max(0.25, 4.6 - h * 0.11 + wave * 0.5);
      if (h >= hours - 4) rate = Number((0.2 + (hours - h) * 0.08).toFixed(2));
      amp = Math.max(31, 51 - h * 0.35 + wave);
      freq = Math.max(165, 295 - h * 2.2);
      durMean = Math.max(0.24, 0.71 - h * 0.008);
    } else if (pattern === 'recovering') {
      // Initial suppression then clear recovery after resuscitation & prokinetic
      const recoveryBoost = h > 16 ? (h - 16) * 0.19 : -h * 0.05;
      rate = Math.max(1.4, Math.min(9.2, 2.8 + recoveryBoost + wave));
      amp = Math.min(64, 46 + (h > 16 ? (h - 16) * 0.35 : 0) + wave);
      freq = Math.min(410, 235 + (h > 16 ? (h - 16) * 3.8 : 0));
      durMean = Math.min(1.05, 0.48 + (h > 16 ? (h - 16) * 0.012 : 0));
    } else {
      rate = Math.max(2.1, 3.8 + wave * 0.9);
      amp = 49 + wave * 1.4;
      freq = 275 + wave * 18;
      durMean = 0.58;
    }

    const isi = Number((60 / Math.max(0.3, rate)).toFixed(1));
    points.push({
      hourOffset: h,
      timestampIso: ts,
      validSecondsInHour: Math.min(3600, Math.max(0, validSec)),
      totalSecondsInHour: 3600,
      occurrenceRatePerMin: Number(rate.toFixed(2)),
      durationMeanSec: Number(durMean.toFixed(2)),
      durationMedianSec: Number((durMean * 0.88).toFixed(2)),
      amplitudeDb: Number(amp.toFixed(1)),
      dominantFreqHz: Math.round(freq),
      spectralCentroidHz: Math.round(freq * 1.21),
      interSoundIntervalSec: isi,
    });
  }
  return points;
}

export function createInitialPatients(): PatientRecord[] {
  // Patient 1: BS-AP-0104 — ICU Severe AP, progressive ileus & 4h Silent Abdomen alert
  const p1Admission = '2026-11-15T08:00:00.000Z';
  const p1Trend = build72hTrend(48, 'deteriorating_ileus', p1Admission);
  const p1ValidHrs = Number((p1Trend.reduce((a, b) => a + b.validSecondsInHour, 0) / 3600).toFixed(1));
  const p1DayScales: DayScaleRecord[] = [
    {
      day: 0,
      recordedAtIso: '2026-11-15T09:00:00.000Z',
      labs: {
        amylaseUL: 1480,
        lipaseUL: 2640,
        crpMgL: 112,
        wbc10e9L: 17.8,
        hematocritPct: 48.2,
        creatinineMgDl: 1.7,
        bunMgDl: 27,
        lactateMmolL: 2.9,
        pao2Fio2: 265,
        arterialPh: 7.31,
        sbpMmHg: 96,
        ldhUL: 420,
        astUL: 280,
        glucoseMgDl: 224,
        calciumMgDl: 7.9,
        baseDeficitMeqL: 4.5,
        heartRateBpm: 116,
        respRateBpm: 24,
        tempC: 38.4,
        sodiumMeqL: 138,
        potassiumMeqL: 4.3,
        gcs: 14,
        pleuralEffusion: true,
        impairedMentalStatus: true,
      },
      ransonScore: 4,
      apacheIiScore: 14,
      bisapScore: 4,
      modifiedMarshallScore: 3,
      agiGrade: 2,
    },
    {
      day: 1,
      recordedAtIso: '2026-11-16T08:30:00.000Z',
      labs: {
        amylaseUL: 1190,
        lipaseUL: 2150,
        crpMgL: 218,
        wbc10e9L: 19.4,
        hematocritPct: 41.5,
        creatinineMgDl: 2.2,
        bunMgDl: 32,
        lactateMmolL: 3.6,
        pao2Fio2: 192,
        arterialPh: 7.27,
        sbpMmHg: 86,
        ldhUL: 495,
        astUL: 295,
        glucoseMgDl: 238,
        calciumMgDl: 7.5,
        baseDeficitMeqL: 5.8,
        heartRateBpm: 122,
        respRateBpm: 27,
        tempC: 38.9,
        sodiumMeqL: 136,
        potassiumMeqL: 4.7,
        gcs: 13,
        pleuralEffusion: true,
        impairedMentalStatus: true,
      },
      ransonScore: 7,
      apacheIiScore: 19,
      bisapScore: 5,
      modifiedMarshallScore: 7,
      agiGrade: 3,
    },
    {
      day: 2,
      recordedAtIso: '2026-11-17T08:00:00.000Z',
      labs: {
        amylaseUL: 860,
        lipaseUL: 1620,
        crpMgL: 264,
        wbc10e9L: 20.6,
        hematocritPct: 35.4,
        creatinineMgDl: 2.5,
        bunMgDl: 36,
        lactateMmolL: 4.1,
        pao2Fio2: 178,
        arterialPh: 7.24,
        sbpMmHg: 84,
        ldhUL: 510,
        astUL: 265,
        glucoseMgDl: 215,
        calciumMgDl: 7.3,
        baseDeficitMeqL: 6.4,
        heartRateBpm: 124,
        respRateBpm: 28,
        tempC: 39.1,
        sodiumMeqL: 135,
        potassiumMeqL: 4.9,
        gcs: 13,
        pleuralEffusion: true,
        impairedMentalStatus: true,
      },
      ransonScore: 8,
      apacheIiScore: 21,
      bisapScore: 5,
      modifiedMarshallScore: 8,
      agiGrade: 4,
    },
  ];

  // Patient 2: BS-AP-0118 — Recovering motility & EN Ready
  const p2Admission = '2026-11-14T14:00:00.000Z';
  const p2Trend = build72hTrend(60, 'recovering', p2Admission);
  const p2ValidHrs = Number((p2Trend.reduce((a, b) => a + b.validSecondsInHour, 0) / 3600).toFixed(1));
  const p2DayScales: DayScaleRecord[] = [
    {
      day: 0,
      recordedAtIso: '2026-11-14T15:00:00.000Z',
      labs: {
        amylaseUL: 980,
        lipaseUL: 1840,
        crpMgL: 84,
        wbc10e9L: 14.5,
        hematocritPct: 44.8,
        creatinineMgDl: 1.3,
        bunMgDl: 21,
        lactateMmolL: 2.1,
        pao2Fio2: 335,
        arterialPh: 7.38,
        sbpMmHg: 112,
        ldhUL: 310,
        astUL: 145,
        glucoseMgDl: 168,
        calciumMgDl: 8.6,
        baseDeficitMeqL: 2.4,
        heartRateBpm: 102,
        respRateBpm: 20,
        tempC: 37.9,
        sodiumMeqL: 139,
        potassiumMeqL: 4.0,
        gcs: 15,
        pleuralEffusion: false,
        impairedMentalStatus: false,
      },
      ransonScore: 1,
      apacheIiScore: 7,
      bisapScore: 1,
      modifiedMarshallScore: 1,
      agiGrade: 2,
    },
    {
      day: 1,
      recordedAtIso: '2026-11-15T14:00:00.000Z',
      labs: {
        amylaseUL: 620,
        lipaseUL: 1120,
        crpMgL: 118,
        wbc10e9L: 13.1,
        hematocritPct: 40.2,
        creatinineMgDl: 1.1,
        bunMgDl: 18,
        lactateMmolL: 1.5,
        pao2Fio2: 365,
        arterialPh: 7.41,
        sbpMmHg: 118,
        ldhUL: 280,
        astUL: 110,
        glucoseMgDl: 142,
        calciumMgDl: 8.8,
        baseDeficitMeqL: 1.4,
        heartRateBpm: 92,
        respRateBpm: 18,
        tempC: 37.5,
        sodiumMeqL: 140,
        potassiumMeqL: 4.1,
        gcs: 15,
        pleuralEffusion: false,
        impairedMentalStatus: false,
      },
      ransonScore: 1,
      apacheIiScore: 5,
      bisapScore: 1,
      modifiedMarshallScore: 1,
      agiGrade: 1,
    },
    {
      day: 2,
      recordedAtIso: '2026-11-16T14:00:00.000Z',
      labs: {
        amylaseUL: 310,
        lipaseUL: 540,
        crpMgL: 76,
        wbc10e9L: 10.4,
        hematocritPct: 38.9,
        creatinineMgDl: 0.9,
        bunMgDl: 15,
        lactateMmolL: 1.1,
        pao2Fio2: 410,
        arterialPh: 7.42,
        sbpMmHg: 122,
        ldhUL: 245,
        astUL: 82,
        glucoseMgDl: 124,
        calciumMgDl: 9.0,
        baseDeficitMeqL: 0.8,
        heartRateBpm: 82,
        respRateBpm: 16,
        tempC: 37.1,
        sodiumMeqL: 140,
        potassiumMeqL: 4.2,
        gcs: 15,
        pleuralEffusion: false,
        impairedMentalStatus: false,
      },
      ransonScore: 1,
      apacheIiScore: 3,
      bisapScore: 0,
      modifiedMarshallScore: 0,
      agiGrade: 0,
    },
  ];

  // Patient 3: BS-AP-0142 — Transitional AP with <24h valid monitoring warning in first 48h
  const p3Admission = '2026-11-15T10:00:00.000Z';
  const p3Trend = build72hTrend(44, 'sparse_warning', p3Admission);
  const p3ValidHrs = Number((p3Trend.reduce((a, b) => a + b.validSecondsInHour, 0) / 3600).toFixed(1));
  const p3DayScales: DayScaleRecord[] = [
    {
      day: 0,
      recordedAtIso: '2026-11-15T11:00:00.000Z',
      labs: {
        amylaseUL: 1120,
        lipaseUL: 1920,
        crpMgL: 94,
        wbc10e9L: 15.2,
        hematocritPct: 45.4,
        creatinineMgDl: 1.4,
        bunMgDl: 22,
        lactateMmolL: 2.0,
        pao2Fio2: 315,
        arterialPh: 7.36,
        sbpMmHg: 108,
        ldhUL: 340,
        astUL: 190,
        glucoseMgDl: 178,
        calciumMgDl: 8.4,
        baseDeficitMeqL: 2.8,
        heartRateBpm: 104,
        respRateBpm: 21,
        tempC: 38.1,
        sodiumMeqL: 138,
        potassiumMeqL: 3.9,
        gcs: 15,
        pleuralEffusion: false,
        impairedMentalStatus: false,
      },
      ransonScore: 2,
      apacheIiScore: 9,
      bisapScore: 2,
      modifiedMarshallScore: 2,
      agiGrade: 2,
    },
    {
      day: 1,
      recordedAtIso: '2026-11-16T10:00:00.000Z',
      labs: {
        amylaseUL: 820,
        lipaseUL: 1410,
        crpMgL: 132,
        wbc10e9L: 14.0,
        hematocritPct: 42.1,
        creatinineMgDl: 1.3,
        bunMgDl: 20,
        lactateMmolL: 1.8,
        pao2Fio2: 330,
        arterialPh: 7.38,
        sbpMmHg: 114,
        ldhUL: 310,
        astUL: 165,
        glucoseMgDl: 156,
        calciumMgDl: 8.5,
        baseDeficitMeqL: 2.0,
        heartRateBpm: 96,
        respRateBpm: 19,
        tempC: 37.8,
        sodiumMeqL: 139,
        potassiumMeqL: 4.0,
        gcs: 15,
        pleuralEffusion: false,
        impairedMentalStatus: false,
      },
      ransonScore: 2,
      apacheIiScore: 7,
      bisapScore: 1,
      modifiedMarshallScore: 1,
      agiGrade: 1,
    },
  ];

  const p1: PatientRecord = {
    studyId: 'BS-AP-0104',
    centerCode: 'CTR-01-HPB',
    pii: { fullName: 'Miller, Arthur K.', mrn: 'MRN-884120', bedNumber: 'ICU-04' },
    age: 64,
    sex: 'M',
    bmi: 31.4,
    etiology: 'Biliary',
    admissionIso: p1Admission,
    hoursSinceOnsetAtAdmission: 14,
    blindingMode: 'open_label',
    sensorStatus: {
      connected: true,
      connectionType: 'BLE 5.2',
      batteryPct: 84,
      signalStrengthDbm: -54,
      contactQualityPct: 94,
      detached: false,
      sampleRateInputHz: 16000,
      sampleRateUnifiedHz: 4000,
      bufferedFrames: 0,
    },
    totalMonitoringHours: 48,
    validMonitoringHours: p1ValidHrs,
    validMonitoringRatioPct: Number(((p1ValidHrs / 48) * 100).toFixed(1)),
    insufficient48hWarning: p1ValidHrs < 24,
    checklist: {
      age18To85: true,
      verifiedApWithin48h: true,
      noPriorMajorAbdominalSurgery: true,
      notPregnant: true,
      noNeuromuscularDisease: true,
      noIbdOrIbs: true,
      noActiveOncology: true,
      noAdhesiveAllergy: true,
      eligible: true,
    },
    dayScales: p1DayScales,
    confounders: [
      {
        id: 'cf-101',
        hourOffset: 4,
        timestampIso: '2026-11-15T12:00:00.000Z',
        category: 'iv_fluid',
        agentName: 'Lactated Ringer’s Bolus',
        doseOrVolume: '250 mL/h (3,000 mL/24h)',
      },
      {
        id: 'cf-102',
        hourOffset: 10,
        timestampIso: '2026-11-15T18:00:00.000Z',
        category: 'opioid_analgesic',
        agentName: 'Fentanyl Infusion',
        doseOrVolume: '25 mcg/h IV',
        notes: 'High visceral pain score; monitor for opioid-induced motility suppression',
      },
      {
        id: 'cf-103',
        hourOffset: 28,
        timestampIso: '2026-11-16T12:00:00.000Z',
        category: 'antibiotic',
        agentName: 'Meropenem',
        doseOrVolume: '1 g IV q8h',
      },
    ],
    trend72h: p1Trend,
    segments: generateSegments(0.6, 1, true),
    prognosis: computePrognosis({ age: 64, bmi: 31.4 }, p1Trend, p1DayScales),
  };

  const p2: PatientRecord = {
    studyId: 'BS-AP-0118',
    centerCode: 'CTR-01-HPB',
    pii: { fullName: 'Kovacs, Elena M.', mrn: 'MRN-884295', bedNumber: 'STEP-11' },
    age: 49,
    sex: 'F',
    bmi: 25.8,
    etiology: 'Hypertriglyceridemic',
    admissionIso: p2Admission,
    hoursSinceOnsetAtAdmission: 19,
    blindingMode: 'open_label',
    sensorStatus: {
      connected: true,
      connectionType: 'USB-C',
      batteryPct: 100,
      signalStrengthDbm: -42,
      contactQualityPct: 97,
      detached: false,
      sampleRateInputHz: 44100,
      sampleRateUnifiedHz: 4000,
      bufferedFrames: 0,
    },
    totalMonitoringHours: 60,
    validMonitoringHours: p2ValidHrs,
    validMonitoringRatioPct: Number(((p2ValidHrs / 60) * 100).toFixed(1)),
    insufficient48hWarning: p2ValidHrs < 24,
    checklist: {
      age18To85: true,
      verifiedApWithin48h: true,
      noPriorMajorAbdominalSurgery: true,
      notPregnant: true,
      noNeuromuscularDisease: true,
      noIbdOrIbs: true,
      noActiveOncology: true,
      noAdhesiveAllergy: true,
      eligible: true,
    },
    dayScales: p2DayScales,
    confounders: [
      {
        id: 'cf-201',
        hourOffset: 6,
        timestampIso: '2026-11-14T20:00:00.000Z',
        category: 'non_opioid_analgesic',
        agentName: 'Paracetamol + Metamizole',
        doseOrVolume: '1000 mg IV q8h',
      },
      {
        id: 'cf-202',
        hourOffset: 22,
        timestampIso: '2026-11-15T12:00:00.000Z',
        category: 'prokinetic',
        agentName: 'Metoclopramide',
        doseOrVolume: '10 mg IV q8h',
      },
      {
        id: 'cf-203',
        hourOffset: 38,
        timestampIso: '2026-11-16T04:00:00.000Z',
        category: 'enteral_nutrition',
        agentName: 'Semi-Elemental EN Initiated',
        doseOrVolume: '25 mL/h -> 50 mL/h',
      },
    ],
    trend72h: p2Trend,
    segments: generateSegments(7.8, 2, false),
    prognosis: computePrognosis({ age: 49, bmi: 25.8 }, p2Trend, p2DayScales),
  };

  const p3: PatientRecord = {
    studyId: 'BS-AP-0142',
    centerCode: 'CTR-02-SURG',
    pii: { fullName: 'Chen, David R.', mrn: 'MRN-884501', bedNumber: 'WARD-22' },
    age: 57,
    sex: 'M',
    bmi: 28.2,
    etiology: 'Alcoholic',
    admissionIso: p3Admission,
    hoursSinceOnsetAtAdmission: 26,
    blindingMode: 'double_blind',
    sensorStatus: {
      connected: true,
      connectionType: 'BLE 5.2',
      batteryPct: 61,
      signalStrengthDbm: -68,
      contactQualityPct: 79,
      detached: false,
      sampleRateInputHz: 8000,
      sampleRateUnifiedHz: 4000,
      bufferedFrames: 12,
    },
    totalMonitoringHours: 44,
    validMonitoringHours: p3ValidHrs,
    validMonitoringRatioPct: Number(((p3ValidHrs / 44) * 100).toFixed(1)),
    insufficient48hWarning: p3ValidHrs < 24,
    checklist: {
      age18To85: true,
      verifiedApWithin48h: true,
      noPriorMajorAbdominalSurgery: true,
      notPregnant: true,
      noNeuromuscularDisease: true,
      noIbdOrIbs: true,
      noActiveOncology: true,
      noAdhesiveAllergy: true,
      eligible: true,
    },
    dayScales: p3DayScales,
    confounders: [
      {
        id: 'cf-301',
        hourOffset: 12,
        timestampIso: '2026-11-15T22:00:00.000Z',
        category: 'antispasmodic',
        agentName: 'Drotaverine',
        doseOrVolume: '40 mg IV',
      },
    ],
    trend72h: p3Trend,
    segments: generateSegments(3.9, 3, false),
    prognosis: computePrognosis({ age: 57, bmi: 28.2 }, p3Trend, p3DayScales),
  };

  return [p1, p2, p3];
}
