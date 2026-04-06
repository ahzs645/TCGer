"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  Loader2,
  Sparkles,
  Target,
  Video,
} from "lucide-react";

import { fetchCardByIdApi } from "@/lib/api-client";
import {
  getCardScanDebugCapturesApi,
  getCardScanStatsApi,
  scanCardImageApi,
  updateCardScanDebugCaptureApi,
  type CardScanDebugCaptureSummary,
  type CardScanMatch,
  type CardScanReviewTag,
  type CardScanResponse,
  type CardScanStats,
} from "@/lib/api/scan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn, GAME_LABELS, getCardBackImage } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useGameFilterStore } from "@/stores/game-filter";
import type { Card as CardType, TcgCode } from "@/types/card";

type ScanFilter = TcgCode | "all";
type ResolvedCards = Record<string, CardType | null>;
type SelectedFileSource = "file-picker" | "live-camera-frame";

function resultKey(match: Pick<CardScanMatch, "tcg" | "externalId">): string {
  return `${match.tcg}:${match.externalId}`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function confidenceTone(confidence: number): string {
  if (confidence >= 0.9) {
    return "bg-emerald-500/10 text-emerald-700 border-emerald-300";
  }
  if (confidence >= 0.7) {
    return "bg-amber-500/10 text-amber-700 border-amber-300";
  }
  return "bg-rose-500/10 text-rose-700 border-rose-300";
}

const REVIEW_TAG_OPTIONS: Array<{
  value: CardScanReviewTag;
  label: string;
}> = [
  { value: "wrong_printing", label: "Wrong Printing" },
  { value: "wrong_species", label: "Wrong Species" },
  { value: "bad_crop", label: "Bad Crop" },
  { value: "blur", label: "Blur" },
  { value: "glare", label: "Glare" },
  { value: "multiple_cards", label: "Multiple Cards" },
  { value: "energy_or_trainer", label: "Energy / Trainer" },
  { value: "no_card_present", label: "No Card Present" },
];

function formatQuality(
  quality?: { score?: number | null } | null,
): string | null {
  if (
    quality?.score === undefined ||
    quality?.score === null ||
    Number.isNaN(quality.score)
  ) {
    return null;
  }
  return `${Math.round(quality.score * 100)}%`;
}

function feedbackTone(
  status: CardScanDebugCaptureSummary["feedbackStatus"],
): string {
  switch (status) {
    case "correct":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-300";
    case "incorrect":
      return "bg-rose-500/10 text-rose-700 border-rose-300";
    case "needs_review":
      return "bg-amber-500/10 text-amber-700 border-amber-300";
    default:
      return "bg-slate-500/10 text-slate-700 border-slate-300";
  }
}

function formatFeedbackLabel(
  status: CardScanDebugCaptureSummary["feedbackStatus"],
): string {
  switch (status) {
    case "correct":
      return "Confirmed";
    case "incorrect":
      return "Wrong";
    case "needs_review":
      return "Needs Review";
    default:
      return "Unreviewed";
  }
}

function formatCaptureTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(value?: number | null): string | null {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${Math.round(value)}ms`;
}

function formatReviewTag(tag: CardScanReviewTag): string {
  return (
    REVIEW_TAG_OPTIONS.find((entry) => entry.value === tag)?.label ??
    tag.replace(/_/g, " ")
  );
}

function formatRevision(
  revision?: { revision: string; total: number | null } | null,
): string {
  if (!revision) {
    return "unknown";
  }

  return revision.total !== null
    ? `${revision.revision} · ${revision.total.toLocaleString()} entries`
    : revision.revision;
}

export function CardScanPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const { token, isAuthenticated } = useAuthStore((state) => ({
    token: state.token,
    isAuthenticated: state.isAuthenticated,
  }));
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const [scanFilter, setScanFilter] = useState<ScanFilter>(
    selectedGame === "all" ? "all" : selectedGame,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileSource, setSelectedFileSource] =
    useState<SelectedFileSource | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<CardScanStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [result, setResult] = useState<CardScanResponse | null>(null);
  const [resolvedCards, setResolvedCards] = useState<ResolvedCards>({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [debugCaptureError, setDebugCaptureError] = useState<string | null>(
    null,
  );
  const [isScanning, setIsScanning] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isResolvingCards, setIsResolvingCards] = useState(false);
  const [saveDebugCapture, setSaveDebugCapture] = useState(true);
  const [captureNotes, setCaptureNotes] = useState("");
  const [debugCaptures, setDebugCaptures] = useState<
    CardScanDebugCaptureSummary[]
  >([]);
  const [debugCapturesError, setDebugCapturesError] = useState<string | null>(
    null,
  );
  const [isLoadingDebugCaptures, setIsLoadingDebugCaptures] = useState(false);
  const [updatingCaptureId, setUpdatingCaptureId] = useState<string | null>(
    null,
  );
  const [cameraMode, setCameraMode] = useState<"idle" | "starting" | "live">(
    "idle",
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [liveCameraSupported, setLiveCameraSupported] = useState(false);
  const [liveCameraUnavailableReason, setLiveCameraUnavailableReason] =
    useState<string | null>(null);

  useEffect(() => {
    if (selectedGame !== "all") {
      setScanFilter(selectedGame);
    }
  }, [selectedGame]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      if (liveStreamRef.current) {
        liveStreamRef.current.getTracks().forEach((track) => track.stop());
        liveStreamRef.current = null;
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const hasMediaDevices =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia;
    const hasSecureContext = window.isSecureContext;

    if (hasMediaDevices && hasSecureContext) {
      setLiveCameraSupported(true);
      setLiveCameraUnavailableReason(null);
      return;
    }

    setLiveCameraSupported(false);
    if (!hasMediaDevices) {
      setLiveCameraUnavailableReason(
        "This browser does not expose a live camera stream. Still-photo capture remains available.",
      );
      return;
    }

    setLiveCameraUnavailableReason(
      "Live camera preview needs HTTPS or localhost. On plain HTTP, use Take Photo / Upload instead.",
    );
  }, []);

  useEffect(() => {
    if (!token || !isAuthenticated) {
      setStats(null);
      setStatsError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingStats(true);
    setStatsError(null);

    getCardScanStatsApi(token)
      .then((nextStats) => {
        if (cancelled) return;
        setStats(nextStats);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatsError(
          error instanceof Error
            ? error.message
            : "Unable to load scan index stats.",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingStats(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, isAuthenticated]);

  useEffect(() => {
    if (!token || !isAuthenticated) {
      setDebugCaptures([]);
      setDebugCapturesError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingDebugCaptures(true);
    setDebugCapturesError(null);

    getCardScanDebugCapturesApi({ token, limit: 8 })
      .then((response) => {
        if (cancelled) return;
        setDebugCaptures(response.captures);
      })
      .catch((error) => {
        if (cancelled) return;
        setDebugCapturesError(
          error instanceof Error
            ? error.message
            : "Unable to load saved debug captures.",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingDebugCaptures(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, isAuthenticated]);

  useEffect(() => {
    if (!token || !result?.candidates.length) {
      setResolvedCards({});
      return;
    }

    let cancelled = false;
    setIsResolvingCards(true);

    const uniqueCandidates = Array.from(
      new Map(
        result.candidates.map((candidate) => [resultKey(candidate), candidate]),
      ).values(),
    );

    Promise.all(
      uniqueCandidates.map(async (candidate) => {
        try {
          const card = await fetchCardByIdApi({
            tcg: candidate.tcg,
            cardId: candidate.externalId,
            token,
          });
          return [resultKey(candidate), card] as const;
        } catch {
          return [resultKey(candidate), null] as const;
        }
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setResolvedCards(Object.fromEntries(entries));
      })
      .finally(() => {
        if (cancelled) return;
        setIsResolvingCards(false);
      });

    return () => {
      cancelled = true;
    };
  }, [result, token]);

  const handleChooseFile = () => {
    inputRef.current?.click();
  };

  const updateSelectedFile = (
    nextFile: File | null,
    source: SelectedFileSource | null = null,
  ) => {
    setSelectedFile(nextFile);
    setSelectedFileSource(source);
    setScanError(null);
    setDebugCaptureError(null);
    setResult(null);
    setResolvedCards({});
    setPreviewUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return nextFile ? URL.createObjectURL(nextFile) : null;
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) {
      return;
    }

    updateSelectedFile(nextFile, "file-picker");
  };

  const handleClear = () => {
    stopLiveCamera();
    updateSelectedFile(null, null);
    setCameraError(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const stopLiveCamera = () => {
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach((track) => track.stop());
      liveStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraMode("idle");
  };

  const handleStartLiveCamera = async () => {
    if (!liveCameraSupported) {
      return;
    }

    setCameraError(null);
    setCameraMode("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
        },
      });

      if (liveStreamRef.current) {
        liveStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      liveStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      setCameraMode("live");
    } catch (error) {
      setCameraMode("idle");
      setCameraError(
        error instanceof Error
          ? error.message
          : "Unable to open the camera preview.",
      );
    }
  };

  const handleCaptureFrame = async () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;

    if (
      !video ||
      !canvas ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      setCameraError(
        "The live camera preview is not ready yet. Wait a moment and try again.",
      );
      return;
    }

    const longestSide = Math.max(video.videoWidth, video.videoHeight);
    const scale = longestSide > 1600 ? 1600 / longestSide : 1;

    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Unable to capture a frame from the live preview.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!blob) {
      setCameraError("Unable to encode the captured frame.");
      return;
    }

    const file = new File([blob], `card-scan-${Date.now()}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    updateSelectedFile(file, "live-camera-frame");
    stopLiveCamera();
  };

  const handleScan = async () => {
    if (!token || !isAuthenticated) {
      setScanError("Sign in is required before you can scan card photos.");
      return;
    }

    if (!selectedFile) {
      setScanError("Choose a photo or capture one from your camera first.");
      return;
    }

    setIsScanning(true);
    setScanError(null);
    setDebugCaptureError(null);

    try {
      const nextResult = await scanCardImageApi({
        file: selectedFile,
        token,
        tcg: scanFilter,
        saveDebugCapture,
        captureSource: selectedFileSource ?? "file-picker",
        captureNotes,
      });
      setResult(nextResult);
      setDebugCaptureError(nextResult.debugCaptureError ?? null);

      if (nextResult.debugCapture) {
        setDebugCaptures((previous) => {
          const nextItems = [
            nextResult.debugCapture!,
            ...previous.filter(
              (capture) => capture.id !== nextResult.debugCapture!.id,
            ),
          ];

          return nextItems.slice(0, 8);
        });
      }

      const nextStats = await getCardScanStatsApi(token).catch(() => null);
      if (nextStats) {
        setStats(nextStats);
      }
    } catch (error) {
      setResult(null);
      setResolvedCards({});
      setScanError(error instanceof Error ? error.message : "Scanning failed.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleCaptureUpdate = async (
    captureId: string,
    updates: {
      feedbackStatus?: CardScanDebugCaptureSummary["feedbackStatus"];
      reviewTags?: CardScanReviewTag[];
    },
  ) => {
    if (!token) {
      return;
    }

    setUpdatingCaptureId(captureId);
    setDebugCapturesError(null);

    try {
      const response = await updateCardScanDebugCaptureApi({
        captureId,
        token,
        feedbackStatus: updates.feedbackStatus,
        reviewTags: updates.reviewTags,
      });

      setDebugCaptures((previous) =>
        previous.map((capture) =>
          capture.id === response.capture.id ? response.capture : capture,
        ),
      );
    } catch (error) {
      setDebugCapturesError(
        error instanceof Error
          ? error.message
          : "Unable to update debug capture feedback.",
      );
    } finally {
      setUpdatingCaptureId(null);
    }
  };

  const handleCaptureFeedback = async (
    captureId: string,
    feedbackStatus: CardScanDebugCaptureSummary["feedbackStatus"],
  ) => {
    await handleCaptureUpdate(captureId, { feedbackStatus });
  };

  const handleCaptureTagToggle = async (
    capture: CardScanDebugCaptureSummary,
    reviewTag: CardScanReviewTag,
  ) => {
    const nextTags = capture.reviewTags.includes(reviewTag)
      ? capture.reviewTags.filter((tag) => tag !== reviewTag)
      : [...capture.reviewTags, reviewTag];

    await handleCaptureUpdate(capture.id, { reviewTags: nextTags });
  };

  const bestMatch = result?.match ?? null;
  const bestMatchCard = bestMatch ? resolvedCards[resultKey(bestMatch)] : null;
  const scanMeta = result?.meta ?? null;
  const otherCandidates =
    result?.candidates.filter((candidate) => {
      if (!bestMatch) {
        return true;
      }
      return resultKey(candidate) !== resultKey(bestMatch);
    }) ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]" data-oid="w.4k983">
      <Card className="overflow-hidden border-dashed" data-oid="yubn0jd">
        <CardHeader data-oid="9_dwbwx">
          <CardTitle className="flex items-center gap-2" data-oid=":1pdwa-">
            <Camera className="h-5 w-5" data-oid="3975b91" />
            Scan Input
          </CardTitle>
          <CardDescription data-oid="bojbjtr">
            Upload a card photo or open your phone camera. The server compares
            the image against the cached perceptual hash index.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5" data-oid="4pm8r05">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
            data-oid="znu93:2"
          />

          <canvas
            ref={captureCanvasRef}
            className="hidden"
            data-oid="utydvu8"
          />

          <div
            className="overflow-hidden rounded-xl border bg-muted/40"
            data-oid="lkh4upk"
          >
            {cameraMode === "live" ? (
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="h-72 w-full bg-black object-cover"
                data-oid="yk7y1xt"
              />
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt="Selected card preview"
                className="h-72 w-full object-contain bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.9),_rgba(244,244,245,0.6)_55%,_rgba(228,228,231,0.9))] p-4"
                data-oid="-3hfwqa"
              />
            ) : (
              <div
                className="flex h-72 flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.9),_rgba(244,244,245,0.6)_55%,_rgba(228,228,231,0.9))] p-6 text-center"
                data-oid="0e2z9ok"
              >
                <Camera
                  className="h-10 w-10 text-muted-foreground"
                  data-oid="5y8z3d:"
                />
                <div className="space-y-1" data-oid="jpp63i-">
                  <p className="font-medium" data-oid="pohdlwd">
                    No photo selected
                  </p>
                  <p
                    className="text-sm text-muted-foreground"
                    data-oid="m0iw_e_"
                  >
                    Use a straight-on shot with the full card in frame for the
                    best first-pass match.
                  </p>
                </div>
              </div>
            )}
          </div>

          {(liveCameraUnavailableReason || cameraError) && (
            <div
              className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-950"
              data-oid="kuo3q7w"
            >
              {cameraError ?? liveCameraUnavailableReason}
            </div>
          )}

          <div className="space-y-2" data-oid="3upg5jk">
            <label className="text-sm font-medium" data-oid="v417g0p">
              Scan Scope
            </label>
            <Select
              value={scanFilter}
              onValueChange={(value) => setScanFilter(value as ScanFilter)}
              data-oid="2u8za.7"
            >
              <SelectTrigger data-oid="dcufd50">
                <SelectValue
                  placeholder="Auto-detect game"
                  data-oid="erop5k."
                />
              </SelectTrigger>
              <SelectContent data-oid="gf8lvss">
                <SelectItem value="all" data-oid="k2qvbg:">
                  Auto-detect across all games
                </SelectItem>
                <SelectItem value="yugioh" data-oid="i4kpa4a">
                  {GAME_LABELS.yugioh}
                </SelectItem>
                <SelectItem value="magic" data-oid="e_enddk">
                  {GAME_LABELS.magic}
                </SelectItem>
                <SelectItem value="pokemon" data-oid="4:rkdzv">
                  {GAME_LABELS.pokemon}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div
            className="space-y-3 rounded-xl border bg-muted/30 p-4"
            data-oid="pd_-8zj"
          >
            <div
              className="flex items-start justify-between gap-4"
              data-oid="x-:n7x."
            >
              <div className="space-y-1" data-oid="h:jcizy">
                <Label
                  htmlFor="save-debug-capture"
                  className="text-sm font-medium"
                  data-oid=":hhzg7c"
                >
                  Save Debug Capture
                </Label>
                <p className="text-sm text-muted-foreground" data-oid="::._ro7">
                  Store the uploaded image, server guess, candidates, and scan
                  metadata so you can build a training/debug dataset from your
                  phone.
                </p>
              </div>
              <Switch
                id="save-debug-capture"
                checked={saveDebugCapture}
                onCheckedChange={setSaveDebugCapture}
                data-oid="jhk.lk5"
              />
            </div>

            {saveDebugCapture ? (
              <div className="space-y-2" data-oid="skw:6i9">
                <Label
                  htmlFor="capture-notes"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                  data-oid="8aw2w8j"
                >
                  Notes
                </Label>
                <Textarea
                  id="capture-notes"
                  value={captureNotes}
                  onChange={(event) => setCaptureNotes(event.target.value)}
                  placeholder="Optional context, such as video timestamp, lighting issue, or why this sample is interesting."
                  rows={3}
                  data-oid="y8pugqw"
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2" data-oid="f3yjbdg">
            <Button
              type="button"
              onClick={handleChooseFile}
              className="gap-2"
              data-oid=".xlg8_s"
            >
              <Camera className="h-4 w-4" data-oid="0_7f298" />
              Take Photo / Upload
            </Button>
            {cameraMode === "live" ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCaptureFrame}
                  className="gap-2"
                  data-oid="pgkv8t9"
                >
                  <Target className="h-4 w-4" data-oid=":-ugxbb" />
                  Capture Frame
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={stopLiveCamera}
                  data-oid="j_wen7q"
                >
                  Stop Camera
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={handleStartLiveCamera}
                disabled={!liveCameraSupported || cameraMode === "starting"}
                className="gap-2"
                data-oid="-2_6o1s"
              >
                {cameraMode === "starting" ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    data-oid="jw2cnae"
                  />
                ) : (
                  <Video className="h-4 w-4" data-oid="7h:3.ro" />
                )}
                Live Camera
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={handleScan}
              disabled={isScanning || !selectedFile}
              data-oid="l2oa4kg"
            >
              {isScanning ? (
                <Loader2 className="h-4 w-4 animate-spin" data-oid="7-:.eer" />
              ) : (
                <Target className="h-4 w-4" data-oid="c0cjouf" />
              )}
              Scan Card
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClear}
              disabled={!selectedFile && !result}
              data-oid="na6ze-n"
            >
              Reset
            </Button>
          </div>

          {selectedFile && (
            <div
              className="rounded-lg border bg-background px-3 py-2 text-sm"
              data-oid="zl:uvlz"
            >
              <p className="font-medium" data-oid="c302d6t">
                {selectedFile.name}
              </p>
              <p className="text-muted-foreground" data-oid="hnb5ow6">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          )}

          <div
            className="rounded-xl border bg-muted/30 p-4 text-sm"
            data-oid="wmcahwd"
          >
            <p className="font-medium" data-oid="1_viq:t">
              Phone Testing Notes
            </p>
            <p className="mt-1 text-muted-foreground" data-oid="invx4i3">
              Still-photo capture works on the current HTTP test stack. Live
              browser camera preview only becomes available on HTTPS or
              localhost because mobile browsers require a secure context for
              streaming camera access.
            </p>
          </div>

          <div
            className="space-y-3 rounded-xl border bg-muted/30 p-4"
            data-oid="us420sf"
          >
            <div
              className="flex items-center justify-between"
              data-oid="3w4bil9"
            >
              <div data-oid="g68f_9k">
                <p className="text-sm font-medium" data-oid="u98memj">
                  Hash Index
                </p>
                <p className="text-xs text-muted-foreground" data-oid="3_wwoh8">
                  Current server-side scan corpus
                </p>
              </div>
              {isLoadingStats && (
                <Loader2
                  className="h-4 w-4 animate-spin text-muted-foreground"
                  data-oid="4ibfxfd"
                />
              )}
            </div>
            {stats ? (
              <div className="flex flex-wrap gap-2" data-oid="hgqrshu">
                <Badge variant="outline" data-oid="0r04xei">
                  Magic {stats.magic}
                </Badge>
                <Badge variant="outline" data-oid="3z84p1c">
                  Pokémon {stats.pokemon}
                </Badge>
                <Badge variant="outline" data-oid="0lrnfz7">
                  Yu-Gi-Oh! {stats.yugioh}
                </Badge>
                <Badge variant="secondary" data-oid="_-h_g._">
                  Store {stats.storeMode}
                </Badge>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-oid="iuvjywf">
                {statsError ?? "Scan stats will load after sign-in."}
              </p>
            )}
          </div>

          <div
            className="space-y-3 rounded-xl border bg-muted/30 p-4"
            data-oid="-126:3_"
          >
            <div
              className="flex items-center justify-between"
              data-oid="0aoswbj"
            >
              <div data-oid="k.3kfs8">
                <p className="text-sm font-medium" data-oid="4v5:989">
                  Recent Debug Captures
                </p>
                <p className="text-xs text-muted-foreground" data-oid="o8xoq_z">
                  Latest saved samples from this account
                </p>
              </div>
              {isLoadingDebugCaptures && (
                <Loader2
                  className="h-4 w-4 animate-spin text-muted-foreground"
                  data-oid="91kcgeb"
                />
              )}
            </div>

            {debugCaptures.length ? (
              <div className="space-y-3" data-oid="bmrlu5o">
                {debugCaptures.map((capture) => (
                  <div
                    key={capture.id}
                    className="space-y-3 rounded-lg border bg-background p-3"
                    data-oid="ulnok3v"
                  >
                    <div className="flex gap-3" data-oid="c8zz_ah">
                      <img
                        src={capture.sourceImageUrl}
                        alt={capture.bestMatch?.name ?? "Saved scan capture"}
                        className="h-20 w-16 shrink-0 rounded-md border object-cover"
                        data-oid="mr9r.4i"
                      />

                      <div
                        className="min-w-0 flex-1 space-y-2"
                        data-oid="a:nn6y8"
                      >
                        <div
                          className="flex flex-wrap items-center gap-2"
                          data-oid=":400faf"
                        >
                          <Badge
                            className={cn(
                              "border",
                              feedbackTone(capture.feedbackStatus),
                            )}
                            data-oid="ec28-0f"
                          >
                            {formatFeedbackLabel(capture.feedbackStatus)}
                          </Badge>
                          {capture.bestMatch?.confidence !== null &&
                          capture.bestMatch?.confidence !== undefined ? (
                            <Badge variant="outline" data-oid="w277-qp">
                              {formatConfidence(capture.bestMatch.confidence)}
                            </Badge>
                          ) : null}
                          {capture.reviewTags.map((tag) => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              data-oid=".fmzs9x"
                            >
                              {formatReviewTag(tag)}
                            </Badge>
                          ))}
                        </div>
                        <div data-oid="42__82t">
                          <p
                            className="truncate text-sm font-medium"
                            data-oid="vtgoevx"
                          >
                            {capture.bestMatch?.name ?? "No best match"}
                          </p>
                          <p
                            className="text-xs text-muted-foreground"
                            data-oid="-pks-a4"
                          >
                            {capture.bestMatch?.tcg
                              ? GAME_LABELS[capture.bestMatch.tcg]
                              : "Unknown game"}
                            {capture.bestMatch?.distance !== null &&
                            capture.bestMatch?.distance !== undefined
                              ? ` • Distance ${capture.bestMatch.distance}`
                              : ""}
                          </p>
                          <p
                            className="text-xs text-muted-foreground"
                            data-oid="p3axb69"
                          >
                            {formatCaptureTime(capture.createdAt)}
                          </p>
                        </div>
                        <div
                          className="flex flex-wrap gap-2"
                          data-oid="bb2103:"
                        >
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={updatingCaptureId === capture.id}
                            onClick={() =>
                              handleCaptureFeedback(capture.id, "correct")
                            }
                            data-oid="bi_kvgb"
                          >
                            Correct
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={updatingCaptureId === capture.id}
                            onClick={() =>
                              handleCaptureFeedback(capture.id, "incorrect")
                            }
                            data-oid="95dia9h"
                          >
                            Wrong
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={updatingCaptureId === capture.id}
                            onClick={() =>
                              handleCaptureFeedback(capture.id, "unreviewed")
                            }
                            data-oid="zuk:glk"
                          >
                            Reset
                          </Button>
                        </div>
                      </div>
                    </div>

                    <details
                      className="rounded-md border bg-muted/20 px-3 py-2 text-sm"
                      data-oid="y7y412u"
                    >
                      <summary
                        className="cursor-pointer select-none font-medium"
                        data-oid="nth1x.o"
                      >
                        Debug details
                      </summary>
                      <div className="mt-3 space-y-3" data-oid="nsuybk_">
                        <div className="space-y-2" data-oid="90j.fvx">
                          <p
                            className="text-xs uppercase tracking-wide text-muted-foreground"
                            data-oid="9x:hgz:"
                          >
                            Derived crops
                          </p>
                          <div
                            className="flex flex-wrap gap-2"
                            data-oid="cjjnna9"
                          >
                            {[
                              {
                                label: "Corrected",
                                url: capture.artifactImages.correctedImageUrl,
                              },
                              {
                                label: "Artwork",
                                url: capture.artifactImages.artworkImageUrl,
                              },
                              {
                                label: "Title",
                                url: capture.artifactImages.titleImageUrl,
                              },
                              {
                                label: "Footer",
                                url: capture.artifactImages.footerImageUrl,
                              },
                            ]
                              .filter((artifact) => artifact.url)
                              .map((artifact) => (
                                <div
                                  key={artifact.label}
                                  className="space-y-1"
                                  data-oid="cgzyoyr"
                                >
                                  <img
                                    src={artifact.url ?? undefined}
                                    alt={`${artifact.label} crop`}
                                    className="h-16 w-16 rounded-md border object-cover"
                                    data-oid="-6u2o6_"
                                  />

                                  <p
                                    className="text-[11px] text-muted-foreground"
                                    data-oid="7iw2.c6"
                                  >
                                    {artifact.label}
                                  </p>
                                </div>
                              ))}
                          </div>
                        </div>

                        <div className="space-y-2" data-oid="iag_iik">
                          <p
                            className="text-xs uppercase tracking-wide text-muted-foreground"
                            data-oid="9:v-eob"
                          >
                            Issue tags
                          </p>
                          <div
                            className="flex flex-wrap gap-2"
                            data-oid="7775kbn"
                          >
                            {REVIEW_TAG_OPTIONS.map((tag) => {
                              const selected = capture.reviewTags.includes(
                                tag.value,
                              );
                              return (
                                <Button
                                  key={tag.value}
                                  type="button"
                                  size="sm"
                                  variant={selected ? "secondary" : "outline"}
                                  disabled={updatingCaptureId === capture.id}
                                  onClick={() =>
                                    handleCaptureTagToggle(capture, tag.value)
                                  }
                                  data-oid="y3sbyq7"
                                >
                                  {tag.label}
                                </Button>
                              );
                            })}
                          </div>
                        </div>

                        <div
                          className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2"
                          data-oid="rnj0wfy"
                        >
                          <p data-oid="-g8v4ja">
                            Total{" "}
                            {formatDuration(
                              capture.diagnostics?.timings?.totalMs,
                            ) ?? "n/a"}
                            {" · "}Preprocess{" "}
                            {formatDuration(
                              capture.diagnostics?.timings?.preprocessMs,
                            ) ?? "n/a"}
                          </p>
                          <p data-oid="t6avq.a">
                            Hash{" "}
                            {formatDuration(
                              capture.diagnostics?.timings?.hashMs,
                            ) ?? "n/a"}
                            {" · "}Feature{" "}
                            {formatDuration(
                              capture.diagnostics?.timings?.featureHashMs,
                            ) ?? "n/a"}
                          </p>
                          <p data-oid="m1aazvr">
                            Ranking{" "}
                            {formatDuration(
                              capture.diagnostics?.timings?.rankingMs,
                            ) ?? "n/a"}
                            {" · "}Artwork{" "}
                            {formatDuration(
                              capture.diagnostics?.timings?.artworkRerankMs,
                            ) ?? "n/a"}
                          </p>
                          <p data-oid="pdanqgy">
                            Angle{" "}
                            {capture.diagnostics?.geometry?.rotationAngle !==
                              undefined &&
                            capture.diagnostics?.geometry?.rotationAngle !==
                              null
                              ? `${capture.diagnostics.geometry.rotationAngle.toFixed(1)}°`
                              : "n/a"}
                            {" · "}Aspect{" "}
                            {capture.diagnostics?.geometry?.cropAspectRatio !==
                              undefined &&
                            capture.diagnostics?.geometry?.cropAspectRatio !==
                              null
                              ? capture.diagnostics.geometry.cropAspectRatio.toFixed(
                                  3,
                                )
                              : "n/a"}
                          </p>
                          <p data-oid="r0djy80">
                            Contour{" "}
                            {capture.diagnostics?.geometry
                              ?.contourConfidence !== undefined &&
                            capture.diagnostics?.geometry?.contourConfidence !==
                              null
                              ? `${Math.round(capture.diagnostics.geometry.contourConfidence * 100)}%`
                              : "n/a"}
                            {" · "}Score{" "}
                            {capture.diagnostics?.geometry
                              ?.cropCandidateScore !== undefined &&
                            capture.diagnostics?.geometry
                              ?.cropCandidateScore !== null
                              ? `${Math.round(capture.diagnostics.geometry.cropCandidateScore * 100)}%`
                              : "n/a"}
                          </p>
                          <p data-oid="0nn1rsu">
                            Build{" "}
                            {capture.pipeline?.build.gitSha
                              ? capture.pipeline.build.gitSha.slice(0, 12)
                              : "unknown"}
                            {capture.pipeline?.build.imageTag
                              ? ` · ${capture.pipeline.build.imageTag}`
                              : ""}
                          </p>
                          <p data-oid="97t5hfe">
                            Hash DB{" "}
                            {formatRevision(
                              capture.pipeline?.hashDatabase?.dataset,
                            )}
                          </p>
                          <p data-oid="a:.rnca">
                            Artwork DB{" "}
                            {formatRevision(
                              capture.pipeline?.artworkDatabase?.dataset,
                            )}
                          </p>
                          <p data-oid="f9:t:58">
                            Mask{" "}
                            {capture.diagnostics?.geometry?.maskVariant ??
                              "n/a"}
                            {" · "}Points{" "}
                            {capture.diagnostics?.geometry?.contourPoints
                              ?.length ?? 0}
                          </p>
                        </div>

                        {capture.diagnostics?.artwork ? (
                          <div className="space-y-1" data-oid="h6jxbaw">
                            <p
                              className="text-xs uppercase tracking-wide text-muted-foreground"
                              data-oid="wpt-_wc"
                            >
                              Artwork matches
                            </p>
                            <div
                              className="flex flex-wrap gap-2"
                              data-oid="u_1z6x."
                            >
                              {capture.diagnostics.artwork.rerankTopMatches
                                .slice(0, 3)
                                .map((candidate) => (
                                  <Badge
                                    key={`${candidate.externalId}-rerank`}
                                    variant="outline"
                                    data-oid="7jym7qr"
                                  >
                                    {candidate.name} ·{" "}
                                    {Math.round(candidate.similarity * 100)}%
                                  </Badge>
                                ))}
                              {!capture.diagnostics.artwork.rerankTopMatches
                                .length &&
                              capture.diagnostics.artwork.prefilterTopMatches
                                .length
                                ? capture.diagnostics.artwork.prefilterTopMatches
                                    .slice(0, 3)
                                    .map((candidate) => (
                                      <Badge
                                        key={`${candidate.externalId}-prefilter`}
                                        variant="outline"
                                        data-oid="ujywi1w"
                                      >
                                        {candidate.name} ·{" "}
                                        {Math.round(candidate.similarity * 100)}
                                        %
                                      </Badge>
                                    ))
                                : null}
                            </div>
                          </div>
                        ) : null}

                        {capture.diagnostics?.ocr ? (
                          <div className="space-y-1" data-oid="__hw.u_">
                            <p
                              className="text-xs uppercase tracking-wide text-muted-foreground"
                              data-oid="64xew0h"
                            >
                              OCR
                            </p>
                            <p
                              className="text-xs text-muted-foreground"
                              data-oid="fopx_1z"
                            >
                              {capture.diagnostics.ocr.attempted
                                ? `OCR ${formatDuration(capture.diagnostics.ocr.durationMs) ?? "n/a"}`
                                : "OCR not attempted"}
                            </p>
                            {capture.diagnostics.ocr.candidates.length ? (
                              <div
                                className="flex flex-wrap gap-2"
                                data-oid="ywka8p1"
                              >
                                {capture.diagnostics.ocr.candidates
                                  .slice(0, 3)
                                  .map((candidate, index) => (
                                    <Badge
                                      key={`${candidate.text}-${index}`}
                                      variant="outline"
                                      data-oid="-l_q04a"
                                    >
                                      {candidate.text} ·{" "}
                                      {Math.round(candidate.confidence)}
                                    </Badge>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {capture.diagnostics?.attempts?.length ? (
                          <div className="space-y-1" data-oid="d_utktu">
                            <p
                              className="text-xs uppercase tracking-wide text-muted-foreground"
                              data-oid="dnxwiv:"
                            >
                              Variant attempts
                            </p>
                            <div
                              className="space-y-1 text-xs text-muted-foreground"
                              data-oid="aaavy7j"
                            >
                              {capture.diagnostics.attempts
                                .slice(0, 4)
                                .map((attempt) => (
                                  <p
                                    key={`${capture.id}-${attempt.variant}`}
                                    data-oid="r98oskr"
                                  >
                                    {attempt.variant} · threshold{" "}
                                    {attempt.threshold} · shortlist{" "}
                                    {attempt.shortlistSize} · hash{" "}
                                    {formatDuration(attempt.hashMs) ?? "n/a"}
                                  </p>
                                ))}
                            </div>
                          </div>
                        ) : null}

                        {capture.diagnostics?.rejectedNearMisses?.length ? (
                          <div className="space-y-1" data-oid=".2u9att">
                            <p
                              className="text-xs uppercase tracking-wide text-muted-foreground"
                              data-oid="fklw0ay"
                            >
                              Near misses
                            </p>
                            <div
                              className="flex flex-wrap gap-2"
                              data-oid="qzyt7wy"
                            >
                              {capture.diagnostics.rejectedNearMisses.map(
                                (candidate) => (
                                  <Badge
                                    key={`${candidate.tcg}:${candidate.externalId}`}
                                    variant="outline"
                                    data-oid="jzd8ex:"
                                  >
                                    {candidate.name} · {candidate.distance} ·{" "}
                                    {Math.round(candidate.confidence * 100)}%
                                  </Badge>
                                ),
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-oid="4teyp.s">
                {debugCapturesError ??
                  "Turn on Save Debug Capture and run a scan to start collecting samples."}
              </p>
            )}
          </div>

          {debugCapturesError && debugCaptures.length > 0 && (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              data-oid="r1.719s"
            >
              {debugCapturesError}
            </div>
          )}

          {(scanError || !isAuthenticated) && (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              data-oid="1ytr-9o"
            >
              {scanError ?? "Sign in to upload and scan card photos."}
            </div>
          )}

          {debugCaptureError && (
            <div
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900"
              data-oid="l534gkl"
            >
              {debugCaptureError}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden" data-oid="72j0pz8">
        <CardHeader className="border-b" data-oid="1lndgrv">
          <CardTitle className="flex items-center gap-2" data-oid="b3ehj_a">
            <Sparkles className="h-5 w-5" data-oid="w5md68-" />
            Scan Results
          </CardTitle>
          <CardDescription data-oid="05rhy69">
            Best match first, followed by alternate candidates ranked by
            perceptual-hash distance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6" data-oid="k4b:av_">
          {!result && !isScanning ? (
            <div
              className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center"
              data-oid="j2uxdtu"
            >
              <div className="space-y-3" data-oid="7u0rhby">
                <Target
                  className="mx-auto h-10 w-10 text-muted-foreground"
                  data-oid="ynogg7a"
                />
                <div className="space-y-1" data-oid="o6xtfdh">
                  <p className="font-medium" data-oid="s6tf2sr">
                    Ready to scan
                  </p>
                  <p
                    className="max-w-xl text-sm text-muted-foreground"
                    data-oid="6ng4t5z"
                  >
                    Upload a phone photo, screenshot, or cropped card image and
                    the matcher will compare it against the local hash map.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {isScanning ? (
            <div
              className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center"
              data-oid="e950jsi"
            >
              <div className="space-y-3" data-oid="4zf8506">
                <Loader2
                  className="mx-auto h-10 w-10 animate-spin text-muted-foreground"
                  data-oid="a70uv1z"
                />
                <div className="space-y-1" data-oid="yd7:l71">
                  <p className="font-medium" data-oid="dob_4l8">
                    Computing match candidates
                  </p>
                  <p
                    className="text-sm text-muted-foreground"
                    data-oid="_xyyqiu"
                  >
                    Preprocessing the upload, hashing it, and scoring it against
                    the cached index.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {!isScanning && result && bestMatch && (
            <section className="space-y-4" data-oid="m54so8o">
              <div
                className="flex flex-wrap items-center gap-2"
                data-oid="7rdterb"
              >
                <Badge
                  className={cn("border", confidenceTone(bestMatch.confidence))}
                  data-oid="gr8d::3"
                >
                  {formatConfidence(bestMatch.confidence)} match score
                </Badge>
                <Badge variant="outline" data-oid=".u4yp8g">
                  {GAME_LABELS[bestMatch.tcg]}
                </Badge>
                <Badge variant="outline" data-oid="om7_npv">
                  Distance {bestMatch.distance}
                </Badge>
                {scanMeta?.perspectiveCorrected ? (
                  <Badge variant="secondary" data-oid=":queaa3">
                    Perspective corrected
                  </Badge>
                ) : null}
                {formatQuality(scanMeta?.quality) ? (
                  <Badge variant="secondary" data-oid="48o0rkx">
                    Quality {formatQuality(scanMeta?.quality)}
                  </Badge>
                ) : null}
                {isResolvingCards && (
                  <Badge variant="secondary" data-oid="dumky8h">
                    Refreshing card details…
                  </Badge>
                )}
              </div>

              <div
                className="grid gap-4 rounded-2xl border bg-muted/20 p-4 lg:grid-cols-[220px_1fr]"
                data-oid="h47a2qs"
              >
                <div
                  className="overflow-hidden rounded-xl border bg-background"
                  data-oid="psdydw2"
                >
                  <img
                    src={
                      bestMatchCard?.imageUrlSmall ??
                      bestMatchCard?.imageUrl ??
                      getCardBackImage(bestMatch.tcg)
                    }
                    alt={bestMatch.name}
                    className="h-full w-full object-cover"
                    data-oid="3i.wxyj"
                  />
                </div>
                <div className="space-y-3" data-oid=":2v_pf0">
                  <div data-oid="-7-v20c">
                    <p
                      className="text-sm font-medium text-muted-foreground"
                      data-oid="3ts4mtk"
                    >
                      Best Match
                    </p>
                    <h2
                      className="text-2xl font-heading font-semibold"
                      data-oid="xllop8v"
                    >
                      {bestMatchCard?.name ?? bestMatch.name}
                    </h2>
                    <p
                      className="text-sm text-muted-foreground"
                      data-oid="271t8ya"
                    >
                      {bestMatchCard?.setName ??
                        bestMatch.setName ??
                        bestMatch.setCode ??
                        "Set unknown"}
                      {bestMatch.rarity ? ` • ${bestMatch.rarity}` : ""}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2" data-oid="ldw-ulb">
                    <ScanFact
                      label="Card ID"
                      value={bestMatch.externalId}
                      data-oid="88q-57b"
                    />
                    <ScanFact
                      label="Game"
                      value={GAME_LABELS[bestMatch.tcg]}
                      data-oid="3oqevrg"
                    />
                    <ScanFact
                      label="Set Code"
                      value={bestMatch.setCode ?? "N/A"}
                      data-oid="7-y9f5j"
                    />

                    <ScanFact
                      label="Match Score"
                      value={formatConfidence(bestMatch.confidence)}
                      data-oid="mb9oh9r"
                    />

                    {scanMeta?.variantUsed ? (
                      <ScanFact
                        label="Scan Variant"
                        value={scanMeta.variantUsed}
                        data-oid="oq5zm2."
                      />
                    ) : null}
                    {scanMeta?.thresholdUsed ? (
                      <ScanFact
                        label="Threshold"
                        value={String(scanMeta.thresholdUsed)}
                        data-oid="pnjrbc0"
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          )}

          {!isScanning && result && !bestMatch && (
            <div
              className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
              data-oid="6v3-x69"
            >
              <div className="flex items-start gap-3" data-oid="qm:3_xw">
                <AlertCircle
                  className="mt-0.5 h-5 w-5 shrink-0"
                  data-oid="mhr.-4."
                />
                <div data-oid="dc18rk5">
                  <p className="font-medium" data-oid="dityhqv">
                    No confident match yet
                  </p>
                  <p className="mt-1 text-sm" data-oid="1-0mo_l">
                    The current upload did not land under the confidence
                    threshold. Try a tighter crop, flatter angle, or choose a
                    specific game before rescanning.
                  </p>
                </div>
              </div>
            </div>
          )}

          {!isScanning && otherCandidates.length > 0 && (
            <section className="space-y-3" data-oid="3lym7:_">
              <div data-oid="imhvb7w">
                <h3
                  className="text-lg font-heading font-semibold"
                  data-oid="cov_36d"
                >
                  Alternate Candidates
                </h3>
                <p className="text-sm text-muted-foreground" data-oid="wox9nc-">
                  Useful when the top match is close but not definitive.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2" data-oid="4xeooof">
                {otherCandidates.map((candidate) => {
                  const candidateCard = resolvedCards[resultKey(candidate)];
                  const imageSrc =
                    candidateCard?.imageUrlSmall ??
                    candidateCard?.imageUrl ??
                    getCardBackImage(candidate.tcg);

                  return (
                    <div
                      key={resultKey(candidate)}
                      className="flex gap-4 rounded-xl border bg-background p-3"
                      data-oid="xyqnj_h"
                    >
                      <div
                        className="h-32 w-24 shrink-0 overflow-hidden rounded-lg border bg-muted/30"
                        data-oid="b1w2m:t"
                      >
                        <img
                          src={imageSrc}
                          alt={candidate.name}
                          className="h-full w-full object-cover"
                          data-oid="4y9v7wc"
                        />
                      </div>
                      <div className="min-w-0 space-y-2" data-oid="84-pd48">
                        <div
                          className="flex flex-wrap items-center gap-2"
                          data-oid="196b7-9"
                        >
                          <Badge variant="outline" data-oid="s6q_2-d">
                            {GAME_LABELS[candidate.tcg]}
                          </Badge>
                          <Badge
                            className={cn(
                              "border",
                              confidenceTone(candidate.confidence),
                            )}
                            data-oid="00qykdu"
                          >
                            {formatConfidence(candidate.confidence)}
                          </Badge>
                        </div>
                        <div data-oid="i8r0ii3">
                          <p
                            className="truncate font-semibold"
                            data-oid="cljrk0b"
                          >
                            {candidateCard?.name ?? candidate.name}
                          </p>
                          <p
                            className="text-sm text-muted-foreground"
                            data-oid="pa576m3"
                          >
                            {candidateCard?.setName ??
                              candidate.setName ??
                              candidate.setCode ??
                              "Set unknown"}
                          </p>
                        </div>
                        <p
                          className="text-xs text-muted-foreground"
                          data-oid=".lantkk"
                        >
                          Distance {candidate.distance}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScanFact({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg border bg-background px-3 py-2"
      data-oid=":iio_.w"
    >
      <p
        className="text-xs uppercase tracking-wide text-muted-foreground"
        data-oid="b6c130m"
      >
        {label}
      </p>
      <p className="mt-1 text-sm font-medium" data-oid="b_hp1tg">
        {value}
      </p>
    </div>
  );
}
