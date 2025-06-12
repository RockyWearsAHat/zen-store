import { useState, useRef } from "react";

const isTouch =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer:coarse)").matches || "ontouchstart" in window);

interface Props {
  images: string[];
  className?: string;
}

export default function ImageGallery({ images, className = "" }: Props) {
  const [current, setCurrent] = useState(0);

  /* ----- navigation helpers & swipe detection ----- */
  const total = images.length;
  const next = () => setCurrent((c) => (c < total - 1 ? c + 1 : c));
  const prev = () => setCurrent((c) => (c > 0 ? c - 1 : c));

  /* guard to avoid tap counting twice (touchend → synthetic click) */
  const lastTouch = useRef(0);
  const verticalSwipe = useRef(false); // new

  /* -------------------------------------------------------------
   * gesture tracking refs
   * ----------------------------------------------------------- */
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  /* -------------------------------------------------------------------- */

  /* click inside container: right half -> next, left half -> prev */
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    /* 🚫  disable click-to-advance on touch – avoid snap-back focus */
    if (isTouch) {
      return;
    }

    // prevent browser from scrolling the (possibly off-screen) target into view
    if (Date.now() - lastTouch.current < 400) {
      if (e.cancelable) e.preventDefault(); // cancel duplicate click
      return;
    }
    if (e.cancelable) e.preventDefault(); // also cancel regular clicks

    const { left, width } = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - left;
    x > width / 2 ? next() : prev();
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    verticalSwipe.current = false; // reset
  };

  /* --- touch handlers ------------------------------------------------- */
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (startX.current === null || startY.current === null) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    const isTap = absDx < 10 && absDy < 10;
    const isVertical = absDy > absDx + 10; // dominant vertical

    if (isVertical) {
      verticalSwipe.current = true; // flag for click suppression
      /* vertical scroll → leave browser momentum intact */
      startX.current = startY.current = null;
      lastTouch.current = Date.now();
      return;
    }

    /* tap or horizontal swipe → stop the synthetic click from re-focusing
        the gallery (which caused the snap-to-top). */

    if (isTap) {
      const { left, width } = e.currentTarget.getBoundingClientRect();
      t.clientX - left > width / 2 ? next() : prev();
    } else if (absDx > 40) {
      dx < 0 ? next() : prev();
    }

    startX.current = startY.current = null;
    lastTouch.current = Date.now();
  };
  /* ------------------------------------------------------------------- */

  /* ---------- synthetic-click suppressor ---------- */
  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (verticalSwipe.current) {
      if (e.cancelable) e.preventDefault(); // block focus / scrollIntoView
      e.stopPropagation(); // don’t reach normal onClick
      verticalSwipe.current = false; // one-shot
    }
  };

  /* ---- keyboard navigation ---- */
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      prev();
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      next();
      e.preventDefault();
    }
  };

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div
        className={`relative w-full aspect-square overflow-hidden rounded-xl shadow-lg
                   touch-pan-y ${className}`}
        role="region"
        aria-roledescription="carousel"
        aria-label="Product image gallery"
        tabIndex={0}
        onKeyDown={onKey}
        onClickCapture={handleClickCapture}
        onClick={handleClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* --- slider track ------------------------------------------------ */}
        <div
          className="flex transition-transform duration-300 ease-in-out h-full"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {images.map((src, i) =>
            src.endsWith(".mp4") ? (
              <video
                key={src}
                aria-label={`Product video ${i + 1}`}
                className="w-full h-full min-w-full object-cover"
                onClick={(e) =>
                  e.currentTarget.paused
                    ? e.currentTarget.play()
                    : e.currentTarget.pause()
                }
              >
                <source src={src} type="video/mp4" />
              </video>
            ) : (
              <img
                key={src}
                src={src}
                alt={`Product view ${i + 1}`}
                className="w-full h-full min-w-full object-cover"
              />
            )
          )}
        </div>
        {/* ----------------------------------------------------------------- */}
      </div>
      {/* thumbnail strip */}
      <div
        /* allow horizontal scrolling on mobile, revert to normal on ≥sm */
        className="no-scrollbar
    mt-4 flex gap-2
    overflow-x-auto sm:overflow-visible
    -mx-2 px-2              /* little side-padding so first/last thumb aren’t cut off */
    scroll-smooth           /* nicer feel */
  "
      >
        {images.map((src, i) => (
          <img
            key={src}
            onClick={() => setCurrent(i)}
            className={`w-20 h-20 object-cover cursor-pointer rounded flex-shrink-0 ${
              i === current ? "" : "opacity-70 hover:opacity-100"
            }`}
            src={src}
            alt=""
          />
        ))}
      </div>
    </div>
  );
}
