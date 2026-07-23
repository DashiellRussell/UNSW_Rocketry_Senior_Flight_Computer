/**
 * HazardFrame — a caution BORDER around a control zone: a solid 1.5px
 * amber/red outline, then a translucent diagonal hazard-stripe ring (the
 * dark panel/backdrop behind it shows through the gaps, so it reads as a
 * soft tint rather than a solid fill), then a solid inner panel on top
 * holding the real content. See `.hazard-frame` in app/globals.css.
 *
 * Red (`.hazard-stripes`, a plain opaque fill) stays reserved for the most-
 * critical states — ARMED, board-disconnected, NO-GO — and is untouched.
 * This frame's default is amber, used once as the whole pyro-panel's
 * caution boundary — deliberately NOT applied to the individual arm/fire
 * buttons inside it, which stay plain `.btn-physical` controls so the
 * striping doesn't visually multiply. `variant="red"` is available if a
 * critical zone ever needs the frame treatment instead of the fill.
 */
export function HazardFrame({
  variant = "amber",
  slim = false,
  className = "",
  innerClassName = "",
  children,
}: {
  variant?: "amber" | "red";
  slim?: boolean;
  className?: string;
  innerClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`hazard-frame ${variant === "red" ? "hazard-frame-red" : "hazard-frame-amber"} ${
        slim ? "hazard-frame-slim" : ""
      } ${className}`}
    >
      <div className={`hazard-frame-inner ${innerClassName}`}>{children}</div>
    </div>
  );
}
