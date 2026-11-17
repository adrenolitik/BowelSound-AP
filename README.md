# BowelSound-AP

**BowelSound-AP** is a clinical decision support (CDSS) and prospective research web platform for dynamic severity assessment, therapy response monitoring, and outcome prediction in **acute pancreatitis (AP)** based on continuous acoustic analysis of intestinal peristalsis (phonoenterography).

---

## Core Capabilities

### 1. Bedside Monitor & Audio Ingestion Gateway
- **Sensor & Gateway Telemetry**: Real-time tracking of contact acoustic sensor link (`BLE 5.2` / `USB-C`), battery percentage, RSSI, skin-coupling contact quality index (%), offline gateway frame buffering, and **Valid Monitoring Ratio** (`valid hours / total hours`).
- **48-Hour Adequacy Monitoring**: Automatically flags cohorts with fewer than 24 valid recording hours within the first 48 hours of observation.
- **DSP & Audio Ingestion Pipeline**:
  - Accepts `.wav`/PCM audio uploads (`4 kHz`–`44.1 kHz`) and resamples via Web Audio API to a unified **`4,000 Hz`** pipeline.
  - Segments recordings into non-overlapping **5-second windows** with Signal Quality Assessment (SQA) artifact rejection (clipping, breathing, clothing friction, cough, snoring).
  - **Strict Speech Purge**: Voice-band detections are flagged `speech_purged`, stripped of audio samples prior to persistence, and blocked from playback for HIPAA/GDPR privacy compliance.
  - **No Synthetic Imputation**: Acoustic occurrence rates strictly use cumulative valid recording duration as the denominator; detachment/artifact intervals remain explicit gaps.
- **Interactive Phonoenterogram & Spectrogram**: Color-coded 5s event timeline (`Green` = Bowel Sound, `Slate` = Artifact, `Red` = Signal Loss / Speech Purged), 100–1,000 Hz mel-spectrogram heatmap, MFCC summary inspection, and isolated bowel-sound Web Audio playback.
- **5 Quantitative Acoustic Biomarkers & Synchronized Trends**:
  1. **Occurrence Rate** (`events/min`)
  2. **Event Duration** (mean & median seconds)
  3. **Amplitude / Intensity** (`dB SPL`, with toggleable BMI attenuation compensation)
  4. **Dominant Frequency & Spectral Centroid** (`Hz`)
  5. **Inter-bowel-sound Interval** (`s`)
  - Synchronized `24h / 48h / 72h` longitudinal charts with `15m / 30m / 60m` rolling averages and overlaid clinical confounder markers.

### 2. Clinical Analytics, Severity Calculators & HL7 FHIR R4
- **Outcome Prognosis Panel**:
  - **7-Day Severe Acute Pancreatitis (SAP) Risk** with 95% confidence intervals comparing the **Combined Clinico-Acoustic Model**, **Autonomous BS-only Model**, and **Clinical Scales Alone**.
  - **Enteral Nutrition (EN) Tolerance Traffic Light** (*Ileus / High Risk*, *Transitional Zone*, *Motility Recovery*) paired with the **Motility Recovery Index (0–100)** and feeding recommendations.
  - Secondary outcome forecasts: Predicted Hospital Length of Stay (days), Infected Pancreatic Necrosis / Sepsis risk (%), and 90-Day Mortality risk (%).
- **Silent Abdomen Critical Alert**: Triggers when bowel-sound occurrence rate drops below threshold across $\ge 2$ consecutive valid hours.
- **Dynamic Severity Scale Calculators (`Day 0`, `Day 1`, `Day 2`, `Day 7`)**: Deterministic calculation and trajectory table for **Ranson**, **APACHE II**, **BISAP**, **Modified Marshall**, and **AGI Grade (0–IV)**.
- **HL7 FHIR R4 Integration**:
  - `POST /api/fhir/import`: Parses an HL7 FHIR R4 `Bundle` of LOINC `Observation` resources (Amylase `1798-8`, Lipase `3040-3`, CRP `1988-5`, WBC `6690-2`, Hematocrit `4544-3`, Creatinine `2160-0`, BUN `3094-0`) and recalculates severity scores.
  - `GET /api/fhir/DiagnosticReport/:studyId`: Exports a structured HL7 FHIR R4 `DiagnosticReport`.

### 3. Patient eCRF & Therapy Confounders
- **eCRF Enrollment**: Generates unique de-identified Study IDs (`BS-AP-XXXX`) with segregated PII fields and an automated **Inclusion/Exclusion Checklist** (age 18–85, verified AP within 48h of onset, prior surgery/pregnancy/neuromuscular/IBD/IBS/oncology/adhesive allergy checks).
- **Confounder Timeline Logger**: Logs opioid/non-opioid analgesics, antispasmodics, prokinetics, antibiotics, IV fluid resuscitation volumes, and enteral nutrition timing.

### 4. Research, Manual Annotation & Exports
- **Expert Manual Annotation Tool**: Queue for reviewing disputed (<91% confidence) or all 5s windows, auditioning non-speech clips, and assigning verified labels for CRNN active-learning retraining.
- **TRIPOD+AI Validation Matrix**: Benchmarks Gradient Boosting, Random Forest, SVM, and Logistic Regression across BS-only, Combined, and Clinical-only scopes (`F1 >= 0.81`).
- **Multi-Format Exports**: Client-side generation of **CSV**, multi-sheet **XLSX** workbooks, **JSON** (TRIPOD+AI schema), and structured **Clinical PDF Reports**.

### 5. RBAC, Double-Blind Control & Audit Log
- **4-Role Access Control (`x-user-role`)**:
  - `clinician` — Bedside CDSS, severity scales, and clinical outcomes (restricted to technical sensor telemetry only during Double-Blind mode).
  - `researcher` — Patient eCRF enrollment, SQA monitoring, confounders, and segment annotation.
  - `data_scientist` — De-identified spectrograms, extracted features, and ML validation (**PII always stripped**; clinical charts & outcomes stripped during Double-Blind mode).
  - `admin` — Principal Investigator / System Admin controls for blinding mode, clinical centers, CRNN model versions, and audit inspection.
- **Immutable User Audit Log**: Records RBAC actions, blinding protocol switches, audio ingestion events, FHIR imports/exports, and model deployments.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Web Audio API, `xlsx`, `jspdf`
- **Backend**: Node.js, Express, `tsx` (Vite middleware in development; static serving in production)

---

## Project Structure

```text
├── server.ts                              # Express API, RBAC/Blinding enforcement, FHIR & ingestion endpoints
├── index.html                             # HTML entry point & Google Fonts (Plus Jakarta Sans, DM Sans, IBM Plex Mono)
├── src/
│   ├── App.tsx                            # Workstation shell, RBAC switcher, cohort selector & live stream loop
│   ├── types/clinical.ts                  # Core domain TypeScript interfaces
│   ├── utils/
│   │   ├── clinicalScoring.ts             # Ranson, APACHE II, BISAP, Marshall, MRI & SAP prognostic models
│   │   ├── audioDsp.ts                    # WAV/PCM 4 kHz resampling, 5s DSP windowing & Web Audio synthesis
│   │   └── exportReports.ts               # CSV, XLSX, JSON & Clinical PDF exporters
│   └── components/
│       ├── BedsideMonitorView.tsx         # Sensor telemetry, phonoenterogram, spectrogram & trend charts
│       ├── ClinicalAnalyticsView.tsx      # SAP prognosis, EN traffic light, calculators & HL7 FHIR gateway
│       ├── PatientEcrfView.tsx            # eCRF enrollment, eligibility checklist & confounder logger
│       ├── ResearchAnnotationView.tsx     # Manual annotation queue, TRIPOD+AI benchmarks & exports
│       └── GovernanceSecurityView.tsx     # Double-Blind switches, algorithm governance & audit log
```

---

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run in development** (Express + Vite middleware on port `3000`):
   ```bash
   npm run dev
   ```

3. **Typecheck & build for production**:
   ```bash
   npm run lint
   npm run build
   ```
