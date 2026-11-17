import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { PatientRecord, UserRole } from '../types/clinical';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportDatasetCSV(patient: PatientRecord, role: UserRole) {
  const trends = patient.trend72h ?? [];
  const header = [
    'study_id',
    'center_code',
    'hour_offset',
    'timestamp_iso',
    'valid_seconds_in_hour',
    'total_seconds_in_hour',
    'occurrence_rate_per_min',
    'duration_mean_sec',
    'duration_median_sec',
    'amplitude_db',
    'dominant_freq_hz',
    'spectral_centroid_hz',
    'inter_bowel_sound_interval_sec',
  ];

  const rows = trends.map((t) => [
    patient.studyId,
    patient.centerCode,
    t.hourOffset,
    t.timestampIso,
    t.validSecondsInHour,
    t.totalSecondsInHour,
    t.occurrenceRatePerMin ?? '',
    t.durationMeanSec ?? '',
    t.durationMedianSec ?? '',
    t.amplitudeDb ?? '',
    t.dominantFreqHz ?? '',
    t.spectralCentroidHz ?? '',
    t.interSoundIntervalSec ?? '',
  ]);

  const csvContent =
    `# BowelSound-AP Research Export (Role: ${role}; Speech Segments Purged: True; No Synthetic Imputation: True)\n` +
    [header.join(','), ...rows.map((r) => r.join(','))].join('\n');

  triggerDownload(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), `${patient.studyId}_telemetry.csv`);
}

export function exportDatasetJSON(patient: PatientRecord, role: UserRole) {
  const sanitized = {
    exportSchema: 'BowelSound-AP-TRIPOD-AI-v1',
    exportedAtIso: new Date().toISOString(),
    exportedByRole: role,
    privacyCompliance: {
      piiIncluded: Boolean(patient.pii) && role !== 'data_scientist',
      speechSegmentsPurged: true,
      noSyntheticImputationEnforced: true,
    },
    studyId: patient.studyId,
    centerCode: patient.centerCode,
    demographics: {
      age: patient.age,
      sex: patient.sex,
      bmi: patient.bmi,
      etiology: patient.etiology,
    },
    monitoringCompleteness: {
      totalMonitoringHours: patient.totalMonitoringHours,
      validMonitoringHours: patient.validMonitoringHours,
      validMonitoringRatioPct: patient.validMonitoringRatioPct,
      insufficient48hWarning: patient.insufficient48hWarning,
    },
    trend72h: patient.trend72h ?? [],
    dayScales: role === 'data_scientist' && patient.blindingMode === 'double_blind' ? 'REDACTED_DOUBLE_BLIND' : patient.dayScales ?? [],
    confounders: role === 'data_scientist' && patient.blindingMode === 'double_blind' ? 'REDACTED_DOUBLE_BLIND' : patient.confounders ?? [],
    prognosis: patient.prognosis ?? 'REDACTED_DOUBLE_BLIND',
  };

  triggerDownload(
    new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json;charset=utf-8;' }),
    `${patient.studyId}_dataset.json`
  );
}

export function exportDatasetXLSX(patient: PatientRecord, role: UserRole) {
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    {
      Study_ID: patient.studyId,
      Center: patient.centerCode,
      Age: patient.age,
      Sex: patient.sex,
      BMI: patient.bmi,
      Etiology: patient.etiology,
      Blinding_Mode: patient.blindingMode,
      Total_Hours: patient.totalMonitoringHours,
      Valid_Hours: patient.validMonitoringHours,
      Valid_Ratio_Pct: patient.validMonitoringRatioPct,
      Warning_Less_24h_In_48h: patient.insufficient48hWarning ? 'YES' : 'NO',
    },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Patient_Metadata');

  const trendRows = (patient.trend72h ?? []).map((t) => ({
    Hour_Offset: t.hourOffset,
    Timestamp_ISO: t.timestampIso,
    Valid_Seconds: t.validSecondsInHour,
    Occurrence_Rate_Per_Min: t.occurrenceRatePerMin,
    Duration_Mean_Sec: t.durationMeanSec,
    Duration_Median_Sec: t.durationMedianSec,
    Amplitude_dB: t.amplitudeDb,
    Dominant_Freq_Hz: t.dominantFreqHz,
    Spectral_Centroid_Hz: t.spectralCentroidHz,
    Inter_Sound_Interval_Sec: t.interSoundIntervalSec,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trendRows), 'Acoustic_TimeSeries');

  if (patient.dayScales && patient.dayScales.length > 0) {
    const scaleRows = patient.dayScales.map((d) => ({
      Hospital_Day: `Day ${d.day}`,
      Ranson: d.ransonScore,
      APACHE_II: d.apacheIiScore,
      BISAP: d.bisapScore,
      Modified_Marshall: d.modifiedMarshallScore,
      AGI_Grade: d.agiGrade,
      Amylase_UL: d.labs.amylaseUL,
      Lipase_UL: d.labs.lipaseUL,
      CRP_mgL: d.labs.crpMgL,
      Hematocrit_Pct: d.labs.hematocritPct,
      Creatinine_mgdL: d.labs.creatinineMgDl,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scaleRows), 'Clinical_Scales_Labs');
  }

  if (patient.confounders && patient.confounders.length > 0 && !(role === 'data_scientist' && patient.blindingMode === 'double_blind')) {
    const cfRows = patient.confounders.map((c) => ({
      Hour_Offset: c.hourOffset,
      Timestamp: c.timestampIso,
      Category: c.category,
      Agent: c.agentName,
      Dose_Or_Volume: c.doseOrVolume,
      Notes: c.notes ?? '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cfRows), 'Confounders_Therapy');
  }

  XLSX.writeFile(wb, `${patient.studyId}_research_workbook.xlsx`);
}

export function exportClinicalPdfReport(patient: PatientRecord) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 48;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('BowelSound-AP — Clinical Phonoenterography & CDSS Report', 44, y);
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(`Generated: ${new Date().toISOString()}  |  Center: ${patient.centerCode}  |  Protocol Mode: ${patient.blindingMode}`, 44, y);
  y += 18;

  doc.setDrawColor(203, 213, 225);
  doc.line(44, y, 550, y);
  y += 20;

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('1. Patient Identification & Monitoring Completeness', 44, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const piiText = patient.pii
    ? `Patient: ${patient.pii.fullName} (${patient.pii.mrn}, Bed ${patient.pii.bedNumber})`
    : 'Patient PII: Redacted (De-identified Research Mode)';
  doc.text(`Study ID: ${patient.studyId}  |  ${piiText}`, 44, y);
  y += 14;
  doc.text(
    `Demographics: ${patient.age}y ${patient.sex}  |  BMI: ${patient.bmi} kg/m²  |  Etiology: ${patient.etiology}  |  Admission: ${patient.admissionIso}`,
    44,
    y
  );
  y += 14;
  doc.text(
    `Valid Monitoring Time: ${patient.validMonitoringHours}h / ${patient.totalMonitoringHours}h (${patient.validMonitoringRatioPct}% Valid Ratio) — Zero Synthetic Imputation`,
    44,
    y
  );
  y += 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('2. Quantitative Acoustic Biomarkers (Latest Valid Window)', 44, y);
  y += 16;

  const validTrend = (patient.trend72h ?? []).filter((t) => t.occurrenceRatePerMin !== null);
  const latest = validTrend[validTrend.length - 1];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  if (latest) {
    doc.text(`• Occurrence Rate: ${latest.occurrenceRatePerMin} events/min`, 52, y);
    y += 14;
    doc.text(`• Event Duration (Mean / Median): ${latest.durationMeanSec}s / ${latest.durationMedianSec}s`, 52, y);
    y += 14;
    doc.text(`• Amplitude / Intensity: ${latest.amplitudeDb} dB (Patient BMI: ${patient.bmi})`, 52, y);
    y += 14;
    doc.text(`• Dominant Frequency / Spectral Centroid: ${latest.dominantFreqHz} Hz / ${latest.spectralCentroidHz} Hz`, 52, y);
    y += 14;
    doc.text(`• Inter-bowel-sound Interval: ${latest.interSoundIntervalSec} s`, 52, y);
    y += 22;
  } else {
    doc.text('Acoustic metrics blinded or unavailable under active protocol.', 52, y);
    y += 22;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('3. Prognostic Risk Stratification & Enteral Nutrition Guidance', 44, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  if (patient.prognosis) {
    const pr = patient.prognosis;
    doc.text(
      `• Combined Clinico-Acoustic SAP Risk (First 7 Days): ${pr.combinedSapProbPct}% (95% CI: ${pr.combinedCi95[0]}% – ${pr.combinedCi95[1]}%)`,
      52,
      y
    );
    y += 14;
    doc.text(
      `• BS-only Model Risk: ${pr.bsOnlySapProbPct}% (95% CI: ${pr.bsOnlyCi95[0]}% – ${pr.bsOnlyCi95[1]}%)  |  Clinical Scales Only: ${pr.clinicalScalesSapProbPct}%`,
      52,
      y
    );
    y += 14;
    doc.text(
      `• Motility Recovery Index: ${pr.motilityRecoveryIndex}/100  |  EN Tolerance Zone: ${pr.enteralZone.toUpperCase()}`,
      52,
      y
    );
    y += 14;
    const splitRec = doc.splitTextToSize(`• Nutritional Recommendation: ${pr.enteralRecommendation}`, 490);
    doc.text(splitRec, 52, y);
    y += splitRec.length * 12 + 6;
    doc.text(
      `• Predicted LOS: ${pr.predictedLosDays} days  |  Infected Necrosis/Sepsis Risk: ${pr.infectedNecrosisSepsisRiskPct}%  |  90-Day Mortality: ${pr.mortality90DayRiskPct}%`,
      52,
      y
    );
    y += 14;
    if (pr.silentAbdomenAlert) {
      doc.setTextColor(185, 28, 28);
      doc.setFont('helvetica', 'bold');
      doc.text(`CRITICAL ALERT: Silent Abdomen / Progressive Ileus sustained for ${pr.silentAbdomenHours} consecutive hours.`, 52, y);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'normal');
      y += 18;
    }
  } else {
    doc.text('Prognostic models redacted under Double-Blind Study Protocol.', 52, y);
    y += 20;
  }

  if (patient.dayScales && patient.dayScales.length > 0) {
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('4. Dynamic Clinical Severity Scales', 44, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    patient.dayScales.forEach((d) => {
      doc.text(
        `Day ${d.day}: Ranson ${d.ransonScore} | APACHE II ${d.apacheIiScore} | BISAP ${d.bisapScore} | Mod. Marshall ${d.modifiedMarshallScore} | AGI Grade ${d.agiGrade} | CRP ${d.labs.crpMgL} mg/L | Lipase ${d.labs.lipaseUL} U/L`,
        52,
        y
      );
      y += 13;
    });
  }

  doc.save(`${patient.studyId}_clinical_report.pdf`);
}
