export type UserRole = 'clinician' | 'researcher' | 'data_scientist' | 'admin';

export type SoundClass =
  | 'bowel_sound'
  | 'breathing'
  | 'speech_purged'
  | 'friction'
  | 'cough'
  | 'snoring'
  | 'silence';

export type BlindingMode = 'open_label' | 'double_blind';

export type EnteralZone = 'ileus' | 'transitional' | 'recovery';

export type ConfounderCategory =
  | 'opioid_analgesic'
  | 'non_opioid_analgesic'
  | 'antispasmodic'
  | 'prokinetic'
  | 'antibiotic'
  | 'iv_fluid'
  | 'enteral_nutrition';

export interface PatientPII {
  fullName: string;
  mrn: string;
  bedNumber: string;
}

export interface SensorStatus {
  connected: boolean;
  connectionType: 'BLE 5.2' | 'USB-C';
  batteryPct: number;
  signalStrengthDbm: number;
  contactQualityPct: number;
  detached: boolean;
  sampleRateInputHz: number;
  sampleRateUnifiedHz: 4000;
  bufferedFrames: number;
}

export interface AcousticSegment {
  id: string;
  windowIndex: number;
  startSec: number;
  durationSec: 5;
  classification: SoundClass;
  confidence: number;
  sqaValid: boolean;
  sqaReason?: string;
  speechPurged: boolean;
  occurrenceCount: number;
  eventDurationMeanSec: number;
  amplitudeDb: number;
  dominantFreqHz: number;
  spectralCentroidHz: number;
  interSoundIntervalSec: number | null;
  mfccSummary: number[];
  waveformPeak: number;
  verifiedByExpert?: boolean;
  expertLabel?: SoundClass;
}

export interface AcousticTrendPoint {
  hourOffset: number;
  timestampIso: string;
  validSecondsInHour: number;
  totalSecondsInHour: number;
  occurrenceRatePerMin: number | null; // null if 0 valid seconds (strict no-imputation)
  durationMeanSec: number | null;
  durationMedianSec: number | null;
  amplitudeDb: number | null;
  dominantFreqHz: number | null;
  spectralCentroidHz: number | null;
  interSoundIntervalSec: number | null;
}

export interface ConfounderEvent {
  id: string;
  hourOffset: number;
  timestampIso: string;
  category: ConfounderCategory;
  agentName: string;
  doseOrVolume: string;
  notes?: string;
}

export interface LabMarkers {
  amylaseUL: number;
  lipaseUL: number;
  crpMgL: number;
  wbc10e9L: number;
  hematocritPct: number;
  creatinineMgDl: number;
  bunMgDl: number;
  lactateMmolL: number;
  pao2Fio2: number;
  arterialPh: number;
  sbpMmHg: number;
  ldhUL: number;
  astUL: number;
  glucoseMgDl: number;
  calciumMgDl: number;
  baseDeficitMeqL: number;
  heartRateBpm: number;
  respRateBpm: number;
  tempC: number;
  sodiumMeqL: number;
  potassiumMeqL: number;
  gcs: number;
  pleuralEffusion: boolean;
  impairedMentalStatus: boolean;
}

export interface DayScaleRecord {
  day: 0 | 1 | 2 | 7;
  recordedAtIso: string;
  labs: LabMarkers;
  ransonScore: number;
  apacheIiScore: number;
  bisapScore: number;
  modifiedMarshallScore: number;
  agiGrade: 0 | 1 | 2 | 3 | 4;
}

export interface InclusionExclusionChecklist {
  age18To85: boolean;
  verifiedApWithin48h: boolean;
  noPriorMajorAbdominalSurgery: boolean;
  notPregnant: boolean;
  noNeuromuscularDisease: boolean;
  noIbdOrIbs: boolean;
  noActiveOncology: boolean;
  noAdhesiveAllergy: boolean;
  eligible: boolean;
}

export interface PrognosticOutput {
  bsOnlySapProbPct: number;
  bsOnlyCi95: [number, number];
  combinedSapProbPct: number;
  combinedCi95: [number, number];
  clinicalScalesSapProbPct: number;
  motilityRecoveryIndex: number;
  enteralZone: EnteralZone;
  enteralRecommendation: string;
  predictedLosDays: number;
  infectedNecrosisSepsisRiskPct: number;
  mortality90DayRiskPct: number;
  silentAbdomenAlert: boolean;
  silentAbdomenHours: number;
}

export interface PatientRecord {
  studyId: string;
  centerCode: string;
  pii?: PatientPII; // Omitted when role === 'data_scientist' or blinded
  age: number;
  sex: 'M' | 'F';
  bmi: number;
  etiology: 'Biliary' | 'Alcoholic' | 'Hypertriglyceridemic' | 'Idiopathic' | 'Post-ERCP';
  admissionIso: string;
  hoursSinceOnsetAtAdmission: number;
  blindingMode: BlindingMode;
  sensorStatus: SensorStatus;
  totalMonitoringHours: number;
  validMonitoringHours: number;
  validMonitoringRatioPct: number;
  insufficient48hWarning: boolean;
  checklist?: InclusionExclusionChecklist;
  dayScales?: DayScaleRecord[];
  confounders?: ConfounderEvent[];
  trend72h?: AcousticTrendPoint[];
  segments?: AcousticSegment[];
  prognosis?: PrognosticOutput;
  fhirImportedAt?: string;
  blindedRedactionNotice?: string;
}

export interface ModelBenchmark {
  id: string;
  name: string;
  family: 'Gradient Boosting' | 'Random Forest' | 'SVM' | 'Logistic Regression';
  inputScope: 'BS-only' | 'Combined Clinico-Acoustic' | 'Clinical Scales Only';
  f1EventDetection: number;
  rocAucSap: number;
  sensitivity: number;
  specificity: number;
  brierScore: number;
  calibrationSlope: number;
  tripodAiCompliant: boolean;
}

export interface GovernanceConfig {
  crnnModelVersion: string;
  crnnF1Validated: number;
  activeCenters: string[];
  globalBlindingDefault: BlindingMode;
  strictSpeechPurge: boolean;
  noSyntheticImputation: boolean;
  tlsAndAesStatus: string;
}

export interface AuditLogEntry {
  id: string;
  timestampIso: string;
  actorRole: UserRole;
  actorName: string;
  action: string;
  targetStudyId: string;
  details: string;
}
