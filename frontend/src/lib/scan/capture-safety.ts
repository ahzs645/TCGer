export interface CaptureSafetyState {
  armed: boolean;
  acceptedRecognitionId?: string;
  absentFrames: number;
}

export interface CatalogDecision {
  accepted: boolean;
  reason?: string;
  setCodeHint?: string;
  candidateSetCode?: string;
}

export const INITIAL_CAPTURE_SAFETY: CaptureSafetyState = {
  armed: true,
  absentFrames: 0,
};

/** One accepted physical card produces at most one inventory mutation. */
export function acceptRecognition(
  state: CaptureSafetyState,
  recognitionId: string,
): CaptureSafetyState {
  if (!state.armed) return state;
  return {
    armed: false,
    acceptedRecognitionId: recognitionId,
    absentFrames: 0,
  };
}

/** Rearm only after the card has visibly left the guide for several frames. */
export function observeGuidePresence(
  state: CaptureSafetyState,
  cardPresent: boolean,
  absenceFramesRequired = 3,
): CaptureSafetyState {
  if (state.armed || cardPresent) return { ...state, absentFrames: 0 };
  const absentFrames = state.absentFrames + 1;
  return absentFrames >= absenceFramesRequired
    ? INITIAL_CAPTURE_SAFETY
    : { ...state, absentFrames };
}

export function armNextCapture(): CaptureSafetyState {
  return INITIAL_CAPTURE_SAFETY;
}

export function catalogRejectionMessage(
  decision?: CatalogDecision | null,
): string | null {
  if (!decision || decision.accepted) return null;
  if (decision.reason) return decision.reason;
  if (decision.setCodeHint && decision.candidateSetCode) {
    return `The match is from ${decision.candidateSetCode}, outside pinned set ${decision.setCodeHint}.`;
  }
  return "This recognition is outside the downloaded catalog and was not added.";
}
