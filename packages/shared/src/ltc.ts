export type MobilityStatus = 'INDEPENDENT' | 'ASSISTED' | 'DEPENDENT' | 'UNKNOWN';
export type CognitiveStatus = 'NO_SIGNIFICANT_DISTURBANCE' | 'DISTURBANCE' | 'UNKNOWN';
export type TerminalStatus = 'CONFIRMED' | 'NOT_CONFIRMED' | 'UNKNOWN';

export interface LtcDecisionInput {
  adlTotal: number;
  mobilityStatus: MobilityStatus;
  cognitiveStatus: CognitiveStatus;
  terminalStatus: TerminalStatus;
}

export type LtcDecision =
  | { status: 'SUGGESTED'; groupNumber: 1 | 2 | 3 | 4; rationaleCode: string }
  | { status: 'REQUIRES_CM_REVIEW'; groupNumber: null; rationaleCode: string };

export function suggestLtcGroup(input: LtcDecisionInput): LtcDecision {
  if (input.adlTotal < 0 || input.adlTotal > 20) {
    return { status: 'REQUIRES_CM_REVIEW', groupNumber: null, rationaleCode: 'INVALID_ADL' };
  }
  if ([input.mobilityStatus, input.cognitiveStatus, input.terminalStatus].includes('UNKNOWN')) {
    return { status: 'REQUIRES_CM_REVIEW', groupNumber: null, rationaleCode: 'AMBIGUOUS_INPUT' };
  }
  if (input.mobilityStatus === 'DEPENDENT') {
    return input.terminalStatus === 'CONFIRMED'
      ? { status: 'SUGGESTED', groupNumber: 4, rationaleCode: 'DEPENDENT_TERMINAL' }
      : { status: 'SUGGESTED', groupNumber: 3, rationaleCode: 'DEPENDENT_NOT_TERMINAL' };
  }
  return input.cognitiveStatus === 'DISTURBANCE'
    ? { status: 'SUGGESTED', groupNumber: 2, rationaleCode: 'MOBILE_COGNITIVE_DISTURBANCE' }
    : { status: 'SUGGESTED', groupNumber: 1, rationaleCode: 'MOBILE_NO_COGNITIVE_DISTURBANCE' };
}

