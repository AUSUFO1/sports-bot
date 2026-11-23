import { useState } from "react";

/** Club crest from football-data.org. Falls back to the club's initials if the image is missing or fails. */
export function Crest({ src, name, size = 28 }: { src?: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .replace(/\b(FC|CF|AFC|SC|AC|SV|VfB|VfL|TSG|1\.)\b/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  if (!src || failed) {
    return (
      <span className="crest fallback" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
        {initials}
      </span>
    );
  }
  return (
    <img
      className="crest"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
