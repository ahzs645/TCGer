import type {
  CardScanHashEntry,
  CardScanMatch,
} from "@/lib/api/scan";
import type { TcgCode } from "@/types/card";

export type SupportedTcg = Extract<TcgCode, "magic" | "pokemon" | "yugioh">;

export interface RGBHash {
  r: string;
  g: string;
  b: string;
}

export interface CardFeatureHashes {
  title: RGBHash | null;
  footer: RGBHash | null;
}

export interface VideoQuadPoint {
  x: number;
  y: number;
}

export type VideoQuad = [
  VideoQuadPoint,
  VideoQuadPoint,
  VideoQuadPoint,
  VideoQuadPoint,
];

export interface ImageDataLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface VideoWindowProposal {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BrowserVideoScanCandidate extends CardScanMatch {
  scoreDistance: number;
  passedThreshold: boolean;
  fullDistance: number;
  titleDistance: number | null;
  footerDistance: number | null;
  proposalLabel: string;
}

export interface BrowserVideoProposalMatch {
  proposal: VideoWindowProposal;
  overlayQuad: VideoQuad;
  refinementMethod: string | null;
  isClipped: boolean;
  bestMatch: BrowserVideoScanCandidate | null;
  candidates: BrowserVideoScanCandidate[];
}

export interface BrowserVideoFrameScanResult {
  activeProposal: VideoWindowProposal | null;
  bestMatch: BrowserVideoScanCandidate | null;
  candidates: BrowserVideoScanCandidate[];
  proposalMatches: BrowserVideoProposalMatch[];
}

export interface ProposalBoundaryRefinement {
  quad: VideoQuad;
  method: string;
  isClipped: boolean;
}

export interface CanvasBoundaryRefinement extends ProposalBoundaryRefinement {
  warpedCanvas: HTMLCanvasElement;
}

export type { CardScanHashEntry, TcgCode };
