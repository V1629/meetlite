/**
 * api.ts – All MeetLite backend API calls.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeetingListItem {
  meeting_id: string;
  title: string;
  created_at: string;
  has_transcript: boolean;
  has_summary: boolean;
  preview: string;
}

export interface Meeting {
  meeting_id: string;
  title: string;
  created_at: string;
  transcript: string;
  summary: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error ${res.status}`);
  }
  return res.json();
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

export async function listMeetings(): Promise<MeetingListItem[]> {
  return apiFetch<MeetingListItem[]>("/api/meetings");
}

export async function getMeeting(meetingId: string): Promise<Meeting> {
  return apiFetch<Meeting>(`/api/meetings/${meetingId}`);
}

export async function createMeeting(title?: string): Promise<string> {
  const fd = new FormData();
  fd.append("title", title || "Untitled Meeting");
  const data = await apiFetch<{ meeting_id: string }>("/api/meetings", {
    method: "POST",
    body: fd,
  });
  return data.meeting_id;
}

export async function updateMeetingTitle(meetingId: string, title: string): Promise<void> {
  await apiFetch(`/api/meetings/${meetingId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  await apiFetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
}

export async function transcribeChunk(
  audioBlob: Blob,
  meetingId: string
): Promise<{ chunkTranscript: string; fullTranscript: string }> {
  const fd = new FormData();
  fd.append("audio", audioBlob, "chunk.webm");
  fd.append("meeting_id", meetingId);
  const data = await apiFetch<{ chunk_transcript: string; full_transcript: string }>(
    "/api/transcribe-chunk",
    { method: "POST", body: fd }
  );
  return { chunkTranscript: data.chunk_transcript, fullTranscript: data.full_transcript };
}

export async function finalizeMeeting(
  meetingId: string
): Promise<{ summary: string; fullTranscript: string }> {
  const fd = new FormData();
  fd.append("meeting_id", meetingId);
  const data = await apiFetch<{ summary: string; full_transcript: string }>(
    "/api/finalize-meeting",
    { method: "POST", body: fd }
  );
  return { summary: data.summary, fullTranscript: data.full_transcript };
}
