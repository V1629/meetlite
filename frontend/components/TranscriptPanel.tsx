/**
 * TranscriptPanel.tsx – Displays live or completed transcript.
 *
 * While recording: chunks animate in one by one.
 * After stopping (isDone via isRecording=false + chunks exist): full continuous text.
 */

"use client";

import { useEffect, useRef } from "react";

interface TranscriptPanelProps {
  chunks: string[];
  isRecording: boolean;
}

export default function TranscriptPanel({ chunks, isRecording }: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chunks]);

  if (chunks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[160px] gap-3 text-center">
        <div className="w-8 h-8 rounded-full border border-ash/20 flex items-center justify-center">
          <svg className="w-4 h-4 text-ash/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
        </div>
        <p className="font-mono text-xs text-ash/30 tracking-wider">
          {isRecording
            ? "Listening… transcript appears every 60 seconds"
            : "Start recording to capture transcript"}
        </p>
      </div>
    );
  }

  // After meeting ends: show as flowing prose paragraphs
  if (!isRecording && chunks.length > 0) {
    return (
      <div className="space-y-4">
        {chunks.map((chunk, i) => (
          <div key={i} className="group relative pl-3 border-l border-signal/15 hover:border-signal/40 transition-colors">
            <p className="text-ash-light/80 text-sm leading-7 font-sans">{chunk}</p>
            <span className="font-mono text-[10px] text-ash/20 mt-1 block">
              {Math.floor((i * 60) / 60) > 0
                ? `${i * 60}s – ${(i + 1) * 60}s`
                : `0s – 60s`}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    );
  }

  // While recording: animate chunks in as they arrive
  return (
    <div className="space-y-3">
      {chunks.map((chunk, i) => (
        <div
          key={i}
          className="chunk-in group relative pl-4 border-l border-signal/20 hover:border-signal/50 transition-colors"
        >
          <span className="absolute -left-[3px] top-1.5 w-1.5 h-1.5 rounded-full bg-signal/30 group-hover:bg-signal/70 transition-colors" />
          <p className="text-ash-light/80 text-sm leading-relaxed font-sans">{chunk}</p>
          <span className="font-mono text-[10px] text-ash/30 mt-1 block">chunk {i + 1}</span>
        </div>
      ))}

      {/* Blinking cursor to show we're still listening */}
      <div className="flex items-center gap-2 pl-4">
        <span className="w-1 h-4 bg-signal/60 rounded-sm animate-pulse" />
        <span className="font-mono text-xs text-ash/30">listening…</span>
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
