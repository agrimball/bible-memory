import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class VoiceRecorderService {
  readonly isRecording = signal<boolean>(false);
  readonly hasRecording = signal<boolean>(false);
  readonly isPlaying = signal<boolean>(false);
  readonly recordingDurationSec = signal<number>(0);
  readonly playbackProgressPercent = signal<number>(0);
  readonly usingSimulatedMic = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private recordedAudioUrl: string | null = null;
  private audioElement: HTMLAudioElement | null = null;

  private recordingStartMs = 0;
  private recordingTimerId: ReturnType<typeof setInterval> | null = null;
  private simulatedPlaybackTimerId: ReturnType<typeof setInterval> | null = null;
  private simulatedElapsedSec = 0;

  async startRecording(): Promise<void> {
    if (this.isRecording()) {
      return;
    }

    this.stopAllPlayback();
    this.cleanupPreviousRecordingUrl();
    this.errorMessage.set(null);
    this.hasRecording.set(false);
    this.recordingDurationSec.set(0);
    this.playbackProgressPercent.set(0);
    this.audioChunks = [];

    const canUseRealMic =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined';

    if (canUseRealMic) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mediaStream = stream;
        this.usingSimulatedMic.set(false);

        const mimeType = this.selectSupportedMimeType();
        this.mediaRecorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
          if (event.data && event.data.size > 0) {
            this.audioChunks.push(event.data);
          }
        };

        this.mediaRecorder.start(100);
        this.beginRecordingClock();
        return;
      } catch {
        // Gracefully fall back to simulated microphone for headless browsers / CI / denied mic permissions
        this.stopMediaStreamTracks();
        this.mediaRecorder = null;
      }
    }

    // Fallback: simulated microphone mode
    this.usingSimulatedMic.set(true);
    this.beginRecordingClock();
  }

  async stopRecording(): Promise<void> {
    if (!this.isRecording()) {
      return;
    }

    this.clearRecordingTimer();
    const elapsedSec = Math.max(
      1,
      Math.round(((Date.now() - this.recordingStartMs) / 1000) * 10) / 10
    );
    this.recordingDurationSec.set(elapsedSec);

    if (this.mediaRecorder && !this.usingSimulatedMic()) {
      const recorder = this.mediaRecorder;
      this.mediaRecorder = null;

      await new Promise<void>((resolve) => {
        recorder.onstop = () => {
          const mimeType = recorder.mimeType || 'audio/webm';
          const blob =
            this.audioChunks.length > 0
              ? new Blob(this.audioChunks, { type: mimeType })
              : this.createSilentWavBlob(elapsedSec);
          this.recordedAudioUrl = URL.createObjectURL(blob);
          resolve();
        };

        try {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          } else {
            const blob = this.createSilentWavBlob(elapsedSec);
            this.recordedAudioUrl = URL.createObjectURL(blob);
            resolve();
          }
        } catch {
          const blob = this.createSilentWavBlob(elapsedSec);
          this.recordedAudioUrl = URL.createObjectURL(blob);
          resolve();
        }
      });

      this.stopMediaStreamTracks();
    } else {
      const wavBlob = this.createSilentWavBlob(elapsedSec);
      this.recordedAudioUrl = URL.createObjectURL(wavBlob);
    }

    this.isRecording.set(false);
    this.hasRecording.set(true);
    this.playbackProgressPercent.set(0);
  }

  async stopAndPlayOnFlip(): Promise<void> {
    if (this.isRecording()) {
      await this.stopRecording();
      await this.playRecording();
      return;
    }

    if (this.hasRecording()) {
      await this.playRecording();
    }
  }

  async playRecording(): Promise<void> {
    if (!this.hasRecording()) {
      return;
    }

    if (this.isPlaying()) {
      return;
    }

    // If playback reached the end previously, restart from 0
    if (this.playbackProgressPercent() >= 100) {
      this.playbackProgressPercent.set(0);
      this.simulatedElapsedSec = 0;
      if (this.audioElement) {
        this.audioElement.currentTime = 0;
      }
    }

    if (this.usingSimulatedMic() || !this.recordedAudioUrl) {
      this.startSimulatedPlayback();
      return;
    }

    try {
      if (!this.audioElement) {
        this.audioElement = new Audio(this.recordedAudioUrl);
        this.attachAudioElementListeners(this.audioElement);
      }

      this.isPlaying.set(true);
      await this.audioElement.play();
    } catch {
      // If browser blocks audio playback or codec fails in headless mode, fall back to simulated progress
      this.startSimulatedPlayback();
    }
  }

  pausePlayback(): void {
    if (!this.isPlaying()) {
      return;
    }

    this.clearSimulatedPlaybackTimer();

    if (this.audioElement && !this.audioElement.paused) {
      try {
        this.audioElement.pause();
      } catch {
        // Ignore pause errors
      }
    }

    this.isPlaying.set(false);
  }

  togglePlayback(): void {
    if (this.isPlaying()) {
      this.pausePlayback();
    } else {
      void this.playRecording();
    }
  }

  replayRecording(): void {
    if (!this.hasRecording()) {
      return;
    }

    this.stopAllPlayback();
    this.playbackProgressPercent.set(0);
    this.simulatedElapsedSec = 0;

    if (this.audioElement) {
      try {
        this.audioElement.currentTime = 0;
      } catch {
        // Ignore currentTime reset errors
      }
    }

    void this.playRecording();
  }

  resetForNewCard(): void {
    this.clearRecordingTimer();
    this.stopAllPlayback();

    if (this.mediaRecorder) {
      try {
        if (this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
      } catch {
        // Ignore
      }
      this.mediaRecorder = null;
    }

    this.stopMediaStreamTracks();
    this.cleanupPreviousRecordingUrl();
    this.audioChunks = [];
    this.simulatedElapsedSec = 0;

    this.isRecording.set(false);
    this.hasRecording.set(false);
    this.isPlaying.set(false);
    this.recordingDurationSec.set(0);
    this.playbackProgressPercent.set(0);
    this.usingSimulatedMic.set(false);
    this.errorMessage.set(null);
  }

  private beginRecordingClock(): void {
    this.recordingStartMs = Date.now();
    this.isRecording.set(true);
    this.recordingDurationSec.set(0);

    this.clearRecordingTimer();
    this.recordingTimerId = setInterval(() => {
      const elapsed = Math.round(((Date.now() - this.recordingStartMs) / 1000) * 10) / 10;
      this.recordingDurationSec.set(elapsed);
    }, 100);
  }

  private clearRecordingTimer(): void {
    if (this.recordingTimerId !== null) {
      clearInterval(this.recordingTimerId);
      this.recordingTimerId = null;
    }
  }

  private startSimulatedPlayback(): void {
    this.clearSimulatedPlaybackTimer();
    const totalSec = Math.max(1.5, this.recordingDurationSec() || 3);
    if (this.playbackProgressPercent() >= 100 || this.playbackProgressPercent() <= 0) {
      this.simulatedElapsedSec = 0;
      this.playbackProgressPercent.set(0);
    } else {
      this.simulatedElapsedSec = (this.playbackProgressPercent() / 100) * totalSec;
    }

    this.isPlaying.set(true);
    const stepSec = 0.1;

    this.simulatedPlaybackTimerId = setInterval(() => {
      this.simulatedElapsedSec += stepSec;
      const pct = Math.min(100, Math.round((this.simulatedElapsedSec / totalSec) * 100));
      this.playbackProgressPercent.set(pct);

      if (pct >= 100) {
        this.clearSimulatedPlaybackTimer();
        this.isPlaying.set(false);
      }
    }, stepSec * 1000);
  }

  private clearSimulatedPlaybackTimer(): void {
    if (this.simulatedPlaybackTimerId !== null) {
      clearInterval(this.simulatedPlaybackTimerId);
      this.simulatedPlaybackTimerId = null;
    }
  }

  private stopAllPlayback(): void {
    this.clearSimulatedPlaybackTimer();
    if (this.audioElement) {
      try {
        this.audioElement.pause();
      } catch {
        // Ignore
      }
    }
    this.isPlaying.set(false);
  }

  private attachAudioElementListeners(audio: HTMLAudioElement): void {
    audio.ontimeupdate = () => {
      const duration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : Math.max(1, this.recordingDurationSec());
      const pct = Math.min(100, Math.round((audio.currentTime / duration) * 100));
      this.playbackProgressPercent.set(pct);
    };

    audio.onended = () => {
      this.playbackProgressPercent.set(100);
      this.isPlaying.set(false);
    };

    audio.onerror = () => {
      // Fallback to simulated playback if audio element encounters a decode/output issue
      if (this.isPlaying()) {
        this.startSimulatedPlayback();
      }
    };
  }

  private cleanupPreviousRecordingUrl(): void {
    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.src = '';
      } catch {
        // Ignore
      }
      this.audioElement = null;
    }

    if (this.recordedAudioUrl) {
      try {
        URL.revokeObjectURL(this.recordedAudioUrl);
      } catch {
        // Ignore
      }
      this.recordedAudioUrl = null;
    }
  }

  private stopMediaStreamTracks(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      }
      this.mediaStream = null;
    }
  }

  private selectSupportedMimeType(): string {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return '';
  }

  /**
   * Generates a valid 8kHz 8-bit mono silent WAV Blob so that headless browsers
   * and environments without a physical microphone still get a valid audio Blob URL.
   */
  private createSilentWavBlob(durationSec: number): Blob {
    const sampleRate = 8000;
    const clampedSec = Math.max(0.5, Math.min(durationSec, 30));
    const numSamples = Math.floor(sampleRate * clampedSec);
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);

    const writeAscii = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true); // Byte rate (8-bit mono)
    view.setUint16(32, 1, true); // Block align
    view.setUint16(34, 8, true); // Bits per sample
    writeAscii(36, 'data');
    view.setUint32(40, numSamples, true);

    // 128 is silence in unsigned 8-bit PCM
    for (let i = 0; i < numSamples; i++) {
      view.setUint8(44 + i, 128);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }
}
