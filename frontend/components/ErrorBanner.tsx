/**
 * ErrorBanner.tsx – Displays dismissible error messages.
 */

"use client";

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export default function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 animate-fade-in">
      <span className="text-red-400 text-sm mt-0.5">⚠</span>
      <p className="text-sm text-red-300/90 flex-1 leading-relaxed">{message}</p>
      <button
        onClick={onDismiss}
        className="text-red-400/60 hover:text-red-400 transition-colors text-lg leading-none"
        aria-label="Dismiss error"
      >
        ×
      </button>
    </div>
  );
}
