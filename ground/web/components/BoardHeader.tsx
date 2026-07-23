import type { Profile } from "@/lib/types";
import { accentColor } from "@/lib/accent";

const STATE_TONE: Record<string, string> = {
  PAD: "text-ink-dim border-hairline-bright",
  BOOST: "text-amber border-amber-dim bg-amber/10",
  COAST: "text-cyan border-cyan-dim bg-cyan/10",
  APOGEE: "text-ink border-ink-faint bg-white/5",
  DESCENT: "text-cyan border-cyan-dim bg-cyan/10",
  LANDED: "text-green border-green/40 bg-green/10",
};

export function BoardHeader({
  profile,
  flightState,
  fellBack,
}: {
  profile: Profile;
  flightState: string;
  fellBack: boolean;
}) {
  const accent = accentColor(profile.accent);
  const capsStr = Object.entries(profile.caps)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const stateTone = STATE_TONE[flightState] || STATE_TONE.PAD;

  return (
    <div className="sweep-in mb-2.5">
      {fellBack && (
        <div className="frost mb-2.5 px-4 py-2.5 text-[12px] text-amber">
          No <code className="text-amber">FCD1</code> descriptor arrived within 1.5s — showing a generic
          empty profile. Plain TLM/LOG parsing still works; declare checks/rails/graphs/params/actions in
          firmware to populate the rest of this console.
        </div>
      )}
      <div className="glass flex flex-wrap items-end justify-between gap-2.5 rounded-[10px] px-4 py-3">
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent, boxShadow: `0 0 6px ${accent}` }} />
            <span className="label-caps text-[10px] text-ink-faint">fcd/1 board</span>
          </div>
          <h1 className="font-display text-[16px] font-semibold leading-none tracking-wide text-ink">{profile.name}</h1>
          {profile.sub && <p className="mt-1 text-[11px] text-ink-dim">{profile.sub}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {profile.fw && <span className="pill px-2 py-0.5 text-[10px] tabular">fw {profile.fw}</span>}
          <span className={`rounded border px-2.5 py-1 text-[11px] font-semibold label-caps ${stateTone}`}>
            {flightState}
          </span>
          {capsStr && <span className="pill hidden px-2 py-0.5 text-[10px] tabular md:inline">{capsStr}</span>}
        </div>
      </div>
    </div>
  );
}
