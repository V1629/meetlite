/**
 * page.tsx – Meetings list homepage.
 * Shows all past meetings as cards. Click any card to open it.
 * Extension records meetings; this page is for reviewing them.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { listMeetings, deleteMeeting, MeetingListItem } from "@/services/api";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return formatDate(iso);
}

export default function MeetingsListPage() {
  const [meetings, setMeetings]   = useState<MeetingListItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [deleting, setDeleting]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listMeetings();
      setMeetings(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this meeting? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteMeeting(id);
      setMeetings(prev => prev.filter(m => m.meeting_id !== id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-signal/10 border border-signal/30 flex items-center justify-center">
            <span className="text-signal text-xs">◉</span>
          </div>
          <span className="font-mono text-sm font-semibold tracking-widest text-ash-light uppercase">
            MeetLite
          </span>
        </div>
        <span className="font-mono text-xs text-ash/30 tracking-wider hidden sm:block">
          Meeting History
        </span>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">

        {/* Page title */}
        <div className="mb-8">
          <h1 className="text-3xl font-sans font-semibold text-ash-light tracking-tight">
            Your Meetings
          </h1>
          <p className="text-sm text-ash/50 mt-2">
            Recordings captured by the MeetLite Chrome extension. Click a meeting to view its transcript and AI summary.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <span className="text-red-400 mt-0.5">⚠</span>
            <div>
              <p className="text-sm text-red-300">{error}</p>
              <p className="text-xs text-red-400/60 mt-1">
                Make sure the backend is running at{" "}
                <code className="font-mono bg-red-500/10 px-1 rounded">http://localhost:8000</code>
              </p>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-3 text-ash/40 py-16 justify-center">
            <div className="w-4 h-4 border-2 border-ash/20 border-t-ash/60 rounded-full animate-spin" />
            <span className="font-mono text-sm">Loading meetings…</span>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && meetings.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-ink-soft border border-white/5 flex items-center justify-center">
              <span className="text-3xl">🎙️</span>
            </div>
            <div>
              <p className="text-ash-light font-medium text-lg">No meetings yet</p>
              <p className="text-ash/40 text-sm mt-2 max-w-xs">
                Use the MeetLite Chrome extension during a Google Meet to record your first meeting.
              </p>
            </div>
            <div className="bg-ink-soft/60 border border-white/5 rounded-xl p-5 text-left max-w-sm w-full">
              <p className="font-mono text-xs text-signal/70 tracking-widest uppercase mb-3">Quick start</p>
              {[
                "Start your FastAPI backend",
                "Load the extension in Chrome",
                "Join a Google Meet",
                "Click Start Recording",
                "Come back here to review",
              ].map((step, i) => (
                <div key={i} className="flex gap-3 items-start mb-2 last:mb-0">
                  <span className="font-mono text-xs text-signal/40 mt-0.5 w-4 shrink-0">{i + 1}</span>
                  <span className="text-xs text-ash/60">{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Meetings grid */}
        {!loading && meetings.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-xs text-ash/40 tracking-wider">
                {meetings.length} meeting{meetings.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={load}
                className="font-mono text-xs text-ash/40 hover:text-ash/70 tracking-wider transition-colors"
              >
                ↺ refresh
              </button>
            </div>

            <div className="grid gap-3">
              {meetings.map((m) => (
                <Link
                  key={m.meeting_id}
                  href={`/meetings/${m.meeting_id}`}
                  className="group relative bg-ink-soft/50 hover:bg-ink-soft border border-white/5 hover:border-white/10 rounded-2xl p-5 transition-all duration-200 flex items-start justify-between gap-4 cursor-pointer"
                >
                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <h2 className="font-sans font-semibold text-ash-light text-base truncate">
                        {m.title}
                      </h2>
                      {/* Status badges */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {m.has_transcript && (
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-signal/10 text-signal/80 border border-signal/20">
                            transcript
                          </span>
                        )}
                        {m.has_summary && (
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-blue-400/10 text-blue-400/80 border border-blue-400/20">
                            summary
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Preview text */}
                    {m.preview && (
                      <p className="text-xs text-ash/40 leading-relaxed line-clamp-2 mb-2">
                        {m.preview}…
                      </p>
                    )}

                    {/* Date */}
                    <span className="font-mono text-xs text-ash/30">
                      {timeAgo(m.created_at)}
                    </span>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Open arrow */}
                    <span className="text-ash/20 group-hover:text-signal/60 transition-colors text-lg leading-none">
                      →
                    </span>

                    {/* Delete */}
                    <button
                      onClick={(e) => handleDelete(e, m.meeting_id)}
                      disabled={deleting === m.meeting_id}
                      className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/15 text-ash/30 hover:text-red-400"
                      title="Delete meeting"
                    >
                      {deleting === m.meeting_id ? (
                        <div className="w-3 h-3 border border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                      ) : (
                        <span className="text-sm">✕</span>
                      )}
                    </button>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 px-6 py-3 text-center">
        <p className="font-mono text-xs text-ash/20">
          MeetLite · Whisper transcription · Gemini summarization
        </p>
      </footer>
    </main>
  );
}
