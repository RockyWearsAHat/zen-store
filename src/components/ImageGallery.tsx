import { useState, useRef, useEffect } from "react";

const isTouch =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer:coarse)").matches || "ontouchstart" in window);

interface Props {
  images: string[];
  className?: string;
}

export default function ImageGallery({ images }: Props) {
  const [current, setCurrent] = useState(0);
  // Renamed for clarity: this is the scrollable viewport
  const thumbnailViewportRef = useRef<HTMLDivElement>(null);

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

  // Modified scroll function that avoids interfering with tab order
  const scrollThumbnailIntoView = (index: number) => {
    if (!thumbnailViewportRef.current) return;

    const container =
      thumbnailViewportRef.current.querySelector(".thumbnail-strip");
    if (!container || !container.children[index]) return;

    const thumbnail = container.children[index] as HTMLElement;

    // Use built-in scrollIntoView with a specific alignment
    thumbnail.scrollIntoView({
      behavior: "smooth",
      inline: "center", // Center the thumbnail in the view for maximum outline space
    });
  };

  // Modified effect to prevent focus stealing on initial page load
  useEffect(() => {
    // Only run the effect if we're not in the initial page load
    if (images && images.length > 0) {
      // Add a slight delay to avoid interfering with initial tab order
      const timer = setTimeout(() => {
        // Check if user has already started interacting with the page
        const hasUserInteracted =
          document.activeElement && document.activeElement !== document.body;

        // Only scroll if this isn't the initial mount or user has already interacted
        if (hasUserInteracted) {
          scrollThumbnailIntoView(current);
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [current, images]); // Rerun when current or images change

  return (
    <div className="px-4 flex flex-col gap-4">
      {/* Main image container */}
      <div
        className="w-full aspect-square rounded-xl overflow-hidden"
        role="region"
        aria-roledescription="carousel"
        aria-label="Product image gallery"
        tabIndex={0}
        onKeyDown={onKey}
      >
        <div
          className="relative w-full h-full overflow-hidden rounded-xl shadow-lg touch-pan-y"
          onClickCapture={handleClickCapture}
          onClick={handleClick}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div
            className="flex transition-transform duration-300 ease-in-out h-full"
            style={{ transform: `translateX(-${current * 100}%)` }}
          >
            {images.map((src, i) =>
              src.endsWith(".mp4") ? (
                <video
                  key={src}
                  aria-label={`Product video ${i + 1}`}
                  className="w-full h-full object-cover"
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
                  className="w-full h-full object-cover outline-offset-[-2px_!important]"
                />
              )
            )}
          </div>
        </div>
      </div>

      {/* Thumbnail container */}
      <div
        ref={thumbnailViewportRef}
        className="no-scrollbar w-full overflow-x-auto mt-4"
      >
        <div className="thumbnail-strip flex gap-2 py-2 pr-12">
          {images.map((src, i) => (
            <img
              key={src}
              onClick={() => {
                setCurrent(i);
              }}
              tabIndex={0}
              onFocus={() => {
                setCurrent(i);
                scrollThumbnailIntoView(i);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setCurrent(i);
                  scrollThumbnailIntoView(i);
                  e.preventDefault();
                }
              }}
              className={`w-20 h-20 object-cover cursor-pointer rounded flex-shrink-0 focus:outline-offset-[-2px_!important] ${
                i === current ? "" : "opacity-70 hover:opacity-100"
              }`}
              src={src}
              alt={`Thumbnail of product view ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
