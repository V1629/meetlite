/**
 * RecordingControls.tsx – Compact inline recording control bar for the header.
 * Shows: status badge + elapsed time + Start/Stop button.
 */

"use client";

interface RecordingControlsProps {
  status: "idle" | "recording" | "processing" | "done";
  onStart: () => void;
  onStop: () => void;
  chunkCount: number;
  elapsedSeconds: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function RecordingControls({
  status,
  onStart,
  onStop,
  elapsedSeconds,
}: RecordingControlsProps) {
  const isRecording = status === "recording";
  const isProcessing = status === "processing";
  const isDone = status === "done";

  return (
    <div className="flex items-center gap-4">
      {/* Status indicator */}
      <div className="flex items-center gap-2 min-w-[140px] justify-center">
        {isRecording && (
          <>
            <span className="w-2 h-2 rounded-full bg-red-500 record-pulse shrink-0" />
            <span className="font-mono text-xs text-red-400 tracking-wider">
              REC {formatTime(elapsedSeconds)}
            </span>
          </>
        )}
        {isProcessing && (
          <>
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0" />
            <span className="font-mono text-xs text-yellow-400 tracking-wider">Processing…</span>
          </>
        )}
        {isDone && (
          <>
            <span className="w-2 h-2 rounded-full bg-signal shrink-0" />
            <span className="font-mono text-xs text-signal tracking-wider">Complete</span>
          </>
        )}
        {status === "idle" && (
          <span className="font-mono text-xs text-ash/40 tracking-wider">Ready to record</span>
        )}
      </div>

      {/* Start / Stop button */}
      {!isDone && (
        <button
          onClick={isRecording ? onStop : onStart}
          disabled={isProcessing}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs font-semibold
            tracking-widest uppercase transition-all duration-200 border outline-none
            focus:ring-2 focus:ring-offset-1 focus:ring-offset-ink
            ${isRecording
              ? "bg-red-500/10 border-red-500/60 text-red-400 hover:bg-red-500/20 focus:ring-red-500"
              : isProcessing
              ? "bg-transparent border-white/10 text-ash/30 cursor-not-allowed"
              : "bg-signal/10 border-signal/50 text-signal hover:bg-signal/20 signal-glow focus:ring-signal"
            }
          `}
        >
          {isRecording ? (
            <>
              <span className="w-2.5 h-2.5 rounded-sm bg-red-400" />
              Stop Recording
            </>
          ) : isProcessing ? (
            "Processing…"
          ) : (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-signal" />
              Start Recording
            </>
          )}
        </button>
      )}
    </div>
  );
}
