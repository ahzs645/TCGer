export { buildVideoWindowProposals } from "./proposal-windows";
export { refineCardQuadInImageData } from "./quad-refinement";
export { scanVideoFrameCanvasInBrowser } from "./scan-frame";
export type {
  BrowserVideoFrameScanResult,
  BrowserVideoProposalMatch,
  BrowserVideoScanCandidate,
  CardScanHashEntry,
  CanvasBoundaryRefinement,
  CardFeatureHashes,
  ImageDataLike,
  ProposalBoundaryRefinement,
  RGBHash,
  SupportedTcg,
  TcgCode,
  VideoQuad,
  VideoQuadPoint,
  VideoWindowProposal,
} from "./scan-types";

import { buildVideoWindowProposals } from "./proposal-windows";
import { refineCardQuadInImageData } from "./quad-refinement";
import { scanVideoFrameCanvasInBrowser } from "./scan-frame";

const browserVideoMatcher = {
  buildVideoWindowProposals,
  refineCardQuadInImageData,
  scanVideoFrameCanvasInBrowser,
};

export default browserVideoMatcher;
