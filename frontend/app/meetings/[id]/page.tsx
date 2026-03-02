/**
 * app/meetings/[id]/page.tsx – Meeting detail view.
 *
 * Layout:
 *   Header: back button, editable title, copy buttons
 *   Body:   LEFT panel = full transcript | RIGHT panel = AI summary
 *
 * The transcript is split on newlines (each 60s chunk is a paragraph).
 * The summary is parsed into Key Points / Decisions / Action Items cards.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getMeeting, updateMeetingTitle, Meeting } from "@/services/api";
import SummaryPanel from "@/components/SummaryPanel";

// ─── Transcript renderer ──────────────────────────────────────────────────────

function TranscriptView({ transcript }: { transcript: string }) {
  const chunks = transcript.split("\n").map(c => c.trim()).filter(Boolean);

  if (chunks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
        <span className="text-3xl opacity-30">📝</span>
        <p className="font-mono text-xs text-ash/30 tracking-wider">No transcript recorded</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {chunks.map((chunk, i) => (
        <div
          key={i}
          className="group relative pl-4 border-l-2 border-signal/15 hover:border-signal/40 transition-colors"
        >
          <p className="text-sm text-ash-light/80 leading-7 font-sans">{chunk}</p>
          <span className="font-mono text-[10px] text-ash/20 mt-1.5 block">
            {i === 0 ? "0s – 60s" : `${i * 60}s – ${(i + 1) * 60}s`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Inline title editor ──────────────────────────────────────────────────────

function EditableTitle({ meetingId, initial }: { meetingId: string; initial: string }) {
  const [title, setTitle]   = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function save() {
    const trimmed = title.trim() || "Untitled Meeting";
    setTitle(trimmed);
    setEditing(false);
    setSaving(true);
    try {
      await updateMeetingTitle(meetingId, trimmed);
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setTitle(initial); setEditing(false); } }}
        className="bg-transparent border-b border-signal/40 text-ash-light font-sans font-semibold text-xl outline-none px-0 w-full max-w-sm"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-2 group/title"
      title="Click to rename"
    >
      <h1 className="font-sans font-semibold text-xl text-ash-light text-left">
        {title}
      </h1>
      <span className="text-ash/20 group-hover/title:text-signal/50 transition-colors text-sm">
        {saving ? "…" : "✎"}
      </span>
    </button>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={copy}
      className="font-mono text-xs text-ash/40 hover:text-ash/80 border border-white/8 hover:border-white/15 px-3 py-1.5 rounded-lg transition-all"
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function MeetingDetailPage() {
  const params  = useParams();
  const router  = useRouter();
  const id      = params.id as string;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getMeeting(id)
      .then(setMeeting)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-3 text-ash/40">
        <div className="w-4 h-4 border-2 border-ash/20 border-t-ash/60 rounded-full animate-spin" />
        <span className="font-mono text-sm">Loading meeting…</span>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <p className="text-red-400 font-mono text-sm">⚠ {error || "Meeting not found"}</p>
        <Link href="/" className="font-mono text-xs text-ash/40 hover:text-ash/70 underline">
          ← Back to meetings
        </Link>
      </div>
    );
  }

  const transcriptChunks = meeting.transcript
    ? meeting.transcript.split("\n").map(c => c.trim()).filter(Boolean)
    : [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <header className="border-b border-white/5 px-5 py-3 flex items-start justify-between gap-4 shrink-0">
        {/* Left: back + title */}
        <div className="flex items-start gap-3 min-w-0">
          <Link
            href="/"
            className="font-mono text-xs text-ash/30 hover:text-signal/70 transition-colors mt-1.5 shrink-0"
          >
            ← back
          </Link>
          <div className="min-w-0">
            <EditableTitle meetingId={meeting.meeting_id} initial={meeting.title} />
            <p className="font-mono text-xs text-ash/30 mt-0.5">
              {formatDate(meeting.created_at)}
              {transcriptChunks.length > 0 && (
                <span className="ml-2 text-ash/20">· {transcriptChunks.length} chunks</span>
              )}
            </p>
          </div>
        </div>

        {/* Right: copy buttons */}
        <div className="flex items-center gap-2 shrink-0 mt-1">
          {meeting.transcript && (
            <CopyButton text={meeting.transcript} label="⎘ Copy Transcript" />
          )}
          {meeting.summary && (
            <CopyButton text={meeting.summary} label="⎘ Copy Summary" />
          )}
        </div>
      </header>

      {/* ── Body: two-column ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: Transcript */}
        <div className="flex flex-col w-1/2 border-r border-white/5 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 shrink-0">
            <span className="font-mono text-xs text-ash/50 tracking-widest uppercase">Transcript</span>
            <div className="h-px flex-1 bg-white/5" />
            {transcriptChunks.length > 0 && (
              <span className="font-mono text-xs text-ash/25">
                ~{Math.round(transcriptChunks.length)} min
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <TranscriptView transcript={meeting.transcript} />
          </div>
        </div>

        {/* RIGHT: Summary */}
        <div className="flex flex-col w-1/2 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-signal shrink-0" />
            <span className="font-mono text-xs text-signal/80 tracking-widest uppercase">AI Summary</span>
            <div className="h-px flex-1 bg-white/5" />
            <span className="font-mono text-xs text-ash/25">Gemini</span>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {meeting.summary ? (
              <SummaryPanel summary={meeting.summary} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
                <span className="text-3xl opacity-30">✨</span>
                <p className="font-mono text-xs text-ash/30 tracking-wider">
                  No summary generated yet
                </p>
                <p className="text-xs text-ash/20 max-w-[200px] leading-relaxed">
                  Summary is created automatically when you click Stop Recording in the extension.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
