import { useEffect, useRef } from "react";
import type { InputIntent } from "../engine";

export function useKeyboard(): () => InputIntent {
  const left = useRef(false);
  const right = useRef(false);
  const fire = useRef(false);
  const pauseEdge = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { left.current = true; e.preventDefault(); }
      else if (e.key === "ArrowRight") { right.current = true; e.preventDefault(); }
      else if (e.key === " " || e.key === "Spacebar") { fire.current = true; e.preventDefault(); }
      else if (e.key === "p" || e.key === "P") { if (!e.repeat) pauseEdge.current = true; }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") left.current = false;
      else if (e.key === "ArrowRight") right.current = false;
      else if (e.key === " " || e.key === "Spacebar") fire.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return () => {
    const move = (right.current ? 1 : 0) - (left.current ? 1 : 0);
    const pause = pauseEdge.current;
    pauseEdge.current = false; // consume edge
    return { move: move as -1 | 0 | 1, fire: fire.current, pause };
  };
}
