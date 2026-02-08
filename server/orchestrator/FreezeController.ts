import { ExecQualityLevel } from './types';

export interface FreezeAssessment {
  freezeActive: boolean;
  reason: 'exec_quality_unknown' | 'exec_quality_bad' | null;
}

export function assessFreezeFromExecQuality(quality: ExecQualityLevel): FreezeAssessment {
  if (quality === 'UNKNOWN') {
    return { freezeActive: true, reason: 'exec_quality_unknown' };
  }
  if (quality === 'BAD') {
    return { freezeActive: true, reason: 'exec_quality_bad' };
  }
  return { freezeActive: false, reason: null };
}
