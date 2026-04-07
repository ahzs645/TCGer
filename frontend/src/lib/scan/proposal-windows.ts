import { clamp, createCanvas, getContext2d } from "./canvas-utils";
import type {
  VideoQuad,
  VideoWindowProposal,
} from "./scan-types";

export const CARD_ASPECT_RATIO = 0.714;
export const PROPOSAL_NMS_IOU = 0.4;
export const MAX_ACTIVE_PROPOSALS = 4;
export const PROPOSAL_REFINEMENT_PADDING_RATIO = 0.2;

const PORTRAIT_WINDOW_PRESETS = [
  { label: "portrait-center-xl", scale: 0.9, anchorX: 0.5, anchorY: 0.53 },
  { label: "portrait-center-lg", scale: 0.78, anchorX: 0.5, anchorY: 0.53 },
  { label: "portrait-left-lg", scale: 0.78, anchorX: 0.3, anchorY: 0.53 },
  { label: "portrait-right-lg", scale: 0.78, anchorX: 0.7, anchorY: 0.53 },
  { label: "portrait-left-upper-md", scale: 0.62, anchorX: 0.24, anchorY: 0.34 },
  { label: "portrait-center-upper-md", scale: 0.62, anchorX: 0.5, anchorY: 0.34 },
  { label: "portrait-right-upper-md", scale: 0.62, anchorX: 0.76, anchorY: 0.34 },
  { label: "portrait-left-lower-md", scale: 0.62, anchorX: 0.24, anchorY: 0.7 },
  { label: "portrait-center-lower-md", scale: 0.62, anchorX: 0.5, anchorY: 0.7 },
  { label: "portrait-right-lower-md", scale: 0.62, anchorX: 0.76, anchorY: 0.7 },
  { label: "portrait-left-sm", scale: 0.5, anchorX: 0.18, anchorY: 0.53 },
  { label: "portrait-right-sm", scale: 0.5, anchorX: 0.82, anchorY: 0.53 },
] as const;

export interface ProposalCanvasExtraction {
  canvas: HTMLCanvasElement;
  sourceWindow: VideoWindowProposal;
}

export function buildVideoWindowProposals(
  frameWidth: number,
  frameHeight: number,
): VideoWindowProposal[] {
  const proposals: VideoWindowProposal[] = [];

  for (const preset of PORTRAIT_WINDOW_PRESETS) {
    const height = Math.round(frameHeight * preset.scale);
    const width = Math.round(height * CARD_ASPECT_RATIO);

    if (width >= frameWidth - 8 || height >= frameHeight - 8) {
      continue;
    }

    const left = clamp(
      Math.round(frameWidth * preset.anchorX - width / 2),
      0,
      frameWidth - width,
    );
    const top = clamp(
      Math.round(frameHeight * preset.anchorY - height / 2),
      0,
      frameHeight - height,
    );

    proposals.push({
      label: preset.label,
      left,
      top,
      width,
      height,
    });
  }

  if (proposals.length > 0) {
    return proposals;
  }

  const fallbackWidth = Math.max(
    1,
    Math.min(frameWidth - 4, Math.round((frameHeight - 4) * CARD_ASPECT_RATIO)),
  );
  const fallbackHeight = Math.max(
    1,
    Math.round(fallbackWidth / CARD_ASPECT_RATIO),
  );

  return [
    {
      label: "portrait-fallback",
      left: Math.max(0, Math.round((frameWidth - fallbackWidth) / 2)),
      top: Math.max(0, Math.round((frameHeight - fallbackHeight) / 2)),
      width: fallbackWidth,
      height: Math.min(frameHeight, fallbackHeight),
    },
  ];
}

export function proposalToQuad(proposal: VideoWindowProposal): VideoQuad {
  return [
    { x: proposal.left, y: proposal.top },
    { x: proposal.left + proposal.width, y: proposal.top },
    { x: proposal.left + proposal.width, y: proposal.top + proposal.height },
    { x: proposal.left, y: proposal.top + proposal.height },
  ];
}

export function offsetQuad(
  quad: VideoQuad,
  offsetX: number,
  offsetY: number,
): VideoQuad {
  return quad.map((point) => ({
    x: point.x + offsetX,
    y: point.y + offsetY,
  })) as VideoQuad;
}

export function windowIou(
  left: VideoWindowProposal,
  right: VideoWindowProposal,
): number {
  const leftRight = left.left + left.width;
  const rightRight = right.left + right.width;
  const leftBottom = left.top + left.height;
  const rightBottom = right.top + right.height;

  const overlapWidth =
    Math.max(0, Math.min(leftRight, rightRight) - Math.max(left.left, right.left));
  const overlapHeight =
    Math.max(0, Math.min(leftBottom, rightBottom) - Math.max(left.top, right.top));
  const intersection = overlapWidth * overlapHeight;

  if (intersection <= 0) {
    return 0;
  }

  const leftArea = left.width * left.height;
  const rightArea = right.width * right.height;
  const union = leftArea + rightArea - intersection;

  return union > 0 ? intersection / union : 0;
}

export function expandProposalWindow(
  proposal: VideoWindowProposal,
  frameWidth: number,
  frameHeight: number,
  paddingRatio = PROPOSAL_REFINEMENT_PADDING_RATIO,
): VideoWindowProposal {
  if (paddingRatio <= 0) {
    return proposal;
  }

  const padX = Math.round(proposal.width * paddingRatio);
  const padY = Math.round(proposal.height * paddingRatio);
  const left = clamp(proposal.left - padX, 0, frameWidth - 1);
  const top = clamp(proposal.top - padY, 0, frameHeight - 1);
  const right = clamp(
    proposal.left + proposal.width + padX,
    left + 1,
    frameWidth,
  );
  const bottom = clamp(
    proposal.top + proposal.height + padY,
    top + 1,
    frameHeight,
  );

  return {
    label: proposal.label,
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function extractProposalCanvas(
  frameCanvas: HTMLCanvasElement,
  proposal: VideoWindowProposal,
  paddingRatio = 0,
): ProposalCanvasExtraction {
  const sourceWindow = expandProposalWindow(
    proposal,
    frameCanvas.width,
    frameCanvas.height,
    paddingRatio,
  );
  const canvas = createCanvas(sourceWindow.width, sourceWindow.height);
  const context = getContext2d(canvas);

  context.drawImage(
    frameCanvas,
    sourceWindow.left,
    sourceWindow.top,
    sourceWindow.width,
    sourceWindow.height,
    0,
    0,
    sourceWindow.width,
    sourceWindow.height,
  );

  return {
    canvas,
    sourceWindow,
  };
}
