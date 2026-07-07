import { useState } from "react";
import { buildShareText } from "../lib/shareText";

export function ShareCard(props: {
  date: string; board: number[]; percentile?: number; streak: number; modifier: string;
}) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${window.location.pathname}`;
  const text = buildShareText({ ...props, url });

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* fall through */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="k-bp-share">
      <button className="k-bp-btn k-bp-btn--accent" onClick={share} aria-label="Share your result">
        Share
      </button>
      {copied && <span className="k-bp-share-toast" role="status">Copied!</span>}
    </div>
  );
}
