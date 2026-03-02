/**
 * recorder.ts – MediaRecorder wrapper that handles chunked audio recording.
 *
 * Usage:
 *   const rec = new ChunkedRecorder(60000, onChunk);
 *   await rec.start();
 *   rec.stop();
 *
 * onChunk is called with each completed Blob every `chunkInterval` ms.
 */

export type ChunkHandler = (blob: Blob, mimeType: string) => Promise<void>;

export class ChunkedRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private chunkInterval: number;
  private onChunk: ChunkHandler;
  private mimeType: string = "audio/webm;codecs=opus";

  constructor(chunkIntervalMs: number, onChunk: ChunkHandler) {
    this.chunkInterval = chunkIntervalMs;
    this.onChunk = onChunk;
  }

  /** Requests microphone access and starts recording. */
  async start(): Promise<void> {
    // Request microphone permission
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000, // 16kHz is sufficient for speech transcription
      },
    });

    // Choose a supported MIME type (Safari uses mp4, Chrome/Firefox use webm)
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      this.mimeType = "audio/webm;codecs=opus";
    } else if (MediaRecorder.isTypeSupported("audio/webm")) {
      this.mimeType = "audio/webm";
    } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
      this.mimeType = "audio/mp4";
    } else {
      this.mimeType = ""; // Let the browser decide
    }

    this.startNewRecorder();

    // Every `chunkInterval` ms: flush the current chunk and restart
    this.intervalId = setInterval(() => {
      this.flushChunk();
    }, this.chunkInterval);
  }

  private startNewRecorder(): void {
    this.chunks = [];
    const options = this.mimeType ? { mimeType: this.mimeType } : {};
    this.mediaRecorder = new MediaRecorder(this.stream!, options);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.start();
  }

  /**
   * Stops the current recorder, assembles the Blob, fires onChunk,
   * then immediately starts a new recorder for the next chunk.
   */
  private flushChunk(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return;

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mimeType || "audio/webm" });
      if (blob.size > 0) {
        // Fire the callback asynchronously – don't block the interval
        this.onChunk(blob, this.mimeType || "audio/webm").catch(console.error);
      }
      // Start the next recording segment
      this.startNewRecorder();
    };

    this.mediaRecorder.stop();
  }

  /** Stops recording entirely and flushes the final chunk. */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }

      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        this.releaseStream();
        resolve();
        return;
      }

      this.mediaRecorder.onstop = () => {
        // Send the final partial chunk if it has content
        const blob = new Blob(this.chunks, { type: this.mimeType || "audio/webm" });
        if (blob.size > 0) {
          this.onChunk(blob, this.mimeType || "audio/webm").catch(console.error);
        }
        this.releaseStream();
        resolve();
      };

      this.mediaRecorder.stop();
    });
  }

  private releaseStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  get isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  getMimeType(): string {
    return this.mimeType;
  }
}
