/**
 * SummaryPanel.tsx – Renders the AI-generated meeting summary.
 * Designed for a narrow single-column panel (right side of split view).
 * Parses markdown ## sections into styled cards stacked vertically.
 */

"use client";

interface SummaryPanelProps {
  summary: string;
}

interface Section {
  title: string;
  items: string[];
  icon: string;
  accent: string;
  bg: string;
}

function parseSummary(summary: string): Section[] {
  const defs = [
    {
      title: "Key Points",
      icon: "◆",
      accent: "text-signal border-signal/20",
      bg: "bg-signal/5",
    },
    {
      title: "Decisions",
      icon: "✓",
      accent: "text-blue-400 border-blue-400/20",
      bg: "bg-blue-400/5",
    },
    {
      title: "Action Items",
      icon: "→",
      accent: "text-purple-400 border-purple-400/20",
      bg: "bg-purple-400/5",
    },
  ];

  return defs.map(({ title, icon, accent, bg }) => {
    const regex = new RegExp(`## ${title}([\\s\\S]*?)(?=## |$)`, "i");
    const match = summary.match(regex);
    const items = match
      ? match[1]
          .trim()
          .split("\n")
          .map((l) => l.replace(/^[-*•]\s*/, "").trim())
          .filter(Boolean)
      : [];
    return { title, icon, accent, bg, items };
  });
}

export default function SummaryPanel({ summary }: SummaryPanelProps) {
  const sections = parseSummary(summary);
  const hasParsed = sections.some((s) => s.items.length > 0);

  if (!hasParsed) {
    // Fallback for unexpected Gemini format
    return (
      <div className="bg-ink-soft/60 border border-white/5 rounded-xl p-5">
        <pre className="text-sm text-ash-light/80 whitespace-pre-wrap font-sans leading-relaxed">
          {summary}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-slide-up">
      {sections.map((section) => (
        <div
          key={section.title}
          className={`border rounded-xl p-4 ${section.bg} ${section.accent.split(" ")[1]}`}
        >
          {/* Section header */}
          <div className={`flex items-center gap-2 mb-3 ${section.accent.split(" ")[0]}`}>
            <span className="text-base leading-none">{section.icon}</span>
            <span className="font-mono text-xs tracking-wider uppercase font-semibold">
              {section.title}
            </span>
          </div>

          {/* Items */}
          {section.items.length > 0 ? (
            <ul className="space-y-2">
              {section.items.map((item, i) => (
                <li key={i} className="flex gap-2 text-xs text-ash-light/75 leading-relaxed">
                  <span className={`${section.accent.split(" ")[0]} opacity-40 mt-0.5 shrink-0 text-[10px]`}>
                    ▸
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ash/35 italic">None recorded</p>
          )}
        </div>
      ))}
    </div>
  );
}
