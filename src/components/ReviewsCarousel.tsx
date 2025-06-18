import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FaRegStarHalfStroke, FaStar, FaRegStar } from "react-icons/fa6";

/** very small helper */
function StarRating({ value }: { value: number }) {
  return (
    // role+label lets AT announce the numeric rating once
    <div className="flex" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const full = value >= i;
        const half = !full && value >= i - 0.5;
        return (
          <span
            key={i}
            className={
              full
                ? "text-brand" /* brand colour */
                : half
                ? "text-brand" /* brand colour for half */
                : "text-gray-300"
            }
          >
            {full ? (
              <FaStar size={12} />
            ) : half ? (
              <FaRegStarHalfStroke size={12} />
            ) : (
              <FaRegStar size={12} />
            )}
          </span>
        );
      })}
    </div>
  );
}

const reviews = [
  {
    name: "Alice W.",
    rating: 4.5,
    text: "The water sound keeps me calm on stressful days.",
  },
  {
    name: "James K.",
    rating: 4.5,
    text: "It's a lot bigger than I expected.",
  },
  {
    name: "Olivia P.",
    rating: 5,
    text: "Great gift idea – I've bought two already!",
  },
  {
    name: "Marcus L.",
    rating: 5,
    text: "Looks and feels extremely premium!",
  },
  {
    name: "Priya S.",
    rating: 4,
    text: "Really helped me focus.",
  },
  {
    name: "Daniel T.",
    rating: 4.5,
    text: "Pump is almost silent, exactly what I needed for video calls.",
  },
  {
    name: "Jin‑Ho K.",
    rating: 5,
    text: "Arrived quickly and was pretty easy to assemble.",
  },
  {
    name: "George B.",
    rating: 5,
    text: "Wish I’d bought one sooner.",
  },
  {
    name: "Elena R.",
    rating: 4,
    text: "Adds a nice touch of zen to my home office.",
  },
  {
    name: "Samira N.",
    rating: 4.5,
    text: "The LED glow at night is surprisingly soothing.",
  },
  {
    name: "Carlos M.",
    rating: 5,
    text: "Friends keep asking where I got it!",
  },
];

const baseSets = 3;
const middleSet = Math.floor(baseSets / 2);

export default function ReviewsCarousel() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const carouselWrapperRef = useRef<HTMLDivElement>(null); // Ref for the outer wrapper
  const [dynamicBaseSets, setDynamicBaseSets] = useState(3);

  const singleSetWidth = useRef(0);

  const [reviewSets, setReviewSets] = useState(() =>
    Array(3)
      .fill(null)
      .flatMap(() => [...reviews])
  );

  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1280) {
        setDynamicBaseSets(3);
      } else {
        setDynamicBaseSets(1);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setReviewSets(
      Array(dynamicBaseSets)
        .fill(null)
        .flatMap(() => [...reviews])
    );
  }, [dynamicBaseSets]);

  // Initial setup to measure and position the carousel
  useLayoutEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    if (dynamicBaseSets > 1) {
      // Desktop: Infinite scroll setup
      const contentElement = contentRef.current;
      if (!contentElement) return;

      const updateMeasurements = () => {
        // Get all items in the first set
        const items = Array.from(
          contentElement.querySelectorAll(".review-item")
        ).slice(0, reviews.length);

        if (items.length === 0) return;

        // Calculate the width of one complete set
        let setWidth = 0;
        items.forEach((item) => {
          const el = item as HTMLElement;
          const style = window.getComputedStyle(el);
          const marginLeft = parseFloat(style.marginLeft || "0");
          const marginRight = parseFloat(style.marginRight || "0");
          setWidth += el.offsetWidth + marginLeft + marginRight;
        });

        singleSetWidth.current = setWidth;

        // Position at the middle set
        if (setWidth > 0) {
          // Ensure setWidth is calculated before scrolling
          scrollContainer.scrollLeft = singleSetWidth.current * middleSet;
        }
      };

      // Initial measurement
      updateMeasurements();

      // Re-measure on resize
      window.addEventListener("resize", updateMeasurements);
      return () => window.removeEventListener("resize", updateMeasurements);
    } else {
      // Mobile: Scroll to start
      scrollContainer.scrollLeft = 0;
      // Reset singleSetWidth for mobile as it's not used for infinite scroll logic
      singleSetWidth.current = 0;
    }
  }, [dynamicBaseSets]);

  // --- Robust infinite scroll logic for desktop ---
  useEffect(() => {
    if (dynamicBaseSets <= 1) return;
    const container = scrollRef.current;
    if (!container) return;

    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const setWidth = singleSetWidth.current;
        if (!setWidth) {
          ticking = false;
          return;
        }
        const currentLeft = container.scrollLeft;
        const totalWidth = setWidth * baseSets;
        // Clamp scrollLeft to valid range
        let newScrollLeft = currentLeft;
        if (currentLeft < setWidth * 0.5) {
          // Snap to far right set, preserve offset
          const offsetInSet = currentLeft % setWidth;
          newScrollLeft = (baseSets - 2) * setWidth + offsetInSet;
        } else if (currentLeft > totalWidth - setWidth * 1.5) {
          // Snap to left set, preserve offset
          const offsetInSet = currentLeft % setWidth;
          newScrollLeft = setWidth + offsetInSet;
        }
        // Only update if needed (avoid unnecessary flashes)
        if (Math.abs(newScrollLeft - currentLeft) > 1) {
          container.scrollLeft = newScrollLeft;
        }
        ticking = false;
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [dynamicBaseSets]);

  // Track scroll position on mobile to hide fades at edges
  useEffect(() => {
    if (dynamicBaseSets > 1) {
      setAtStart(false);
      setAtEnd(false);
      return;
    }
    const container = scrollRef.current;
    if (!container) return;

    function updateEdges() {
      if (!container) return;
      const scrollLeft = container.scrollLeft;
      const maxScroll = container.scrollWidth - container.clientWidth;
      setAtStart(scrollLeft <= 1);
      setAtEnd(scrollLeft >= maxScroll - 1);
    }

    updateEdges();
    container.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      container.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [dynamicBaseSets]);

  // --- Autoscroll on desktop (requestAnimationFrame, whole number increments, 30fps cap) ---
  useEffect(() => {
    if (dynamicBaseSets <= 1) return;

    const outerWrapper = carouselWrapperRef.current; // Use the new ref for the outer element
    const scrollContainer = scrollRef.current; // Keep using scrollRef for actual scrolling

    if (!outerWrapper || !scrollContainer) return;

    let rafId: number | null = null;
    const fps = 60;
    const frameDuration = 1000 / fps;
    const speed = 1; // px per frame (adjust for desired speed)
    let paused = false;
    let lastFrame = performance.now();

    function step(now: number) {
      if (paused) return;
      const elapsed = now - lastFrame;
      if (elapsed >= frameDuration) {
        lastFrame = now;
        // Scroll the inner container
        if (scrollContainer && singleSetWidth.current) {
          scrollContainer.scrollLeft += Math.round(speed);
        }
      }
      rafId = requestAnimationFrame(step);
    }

    function start() {
      if (!rafId) {
        lastFrame = performance.now();
        rafId = requestAnimationFrame(step);
      }
    }

    function stop() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    function pause() {
      paused = true;
      stop();
    }

    function resume() {
      if (!paused) return;
      paused = false;
      lastFrame = performance.now();
      start();
    }

    start();

    // Attach listeners to the outer wrapper
    outerWrapper.addEventListener("mouseenter", pause);
    outerWrapper.addEventListener("mouseleave", resume);
    outerWrapper.addEventListener("touchstart", pause, { passive: true });
    outerWrapper.addEventListener("touchend", resume, { passive: true });
    outerWrapper.addEventListener("focusin", pause);
    outerWrapper.addEventListener("focusout", resume);

    return () => {
      stop();
      // Remove listeners from the outer wrapper
      outerWrapper.removeEventListener("mouseenter", pause);
      outerWrapper.removeEventListener("mouseleave", resume);
      outerWrapper.removeEventListener("touchstart", pause);
      outerWrapper.removeEventListener("touchend", resume);
      outerWrapper.removeEventListener("focusin", pause);
      outerWrapper.removeEventListener("focusout", resume);
    };
  }, [dynamicBaseSets]);

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;
    const step = 300;
    if (e.key === "ArrowLeft") {
      scrollRef.current.scrollBy({ left: -step, behavior: "smooth" });
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      scrollRef.current.scrollBy({ left: step, behavior: "smooth" });
      e.preventDefault();
    }
  };

  return (
    <div
      ref={carouselWrapperRef} // Assign the new ref here
      className="relative overflow-hidden reviews-carousel-focus"
      tabIndex={0}
      onKeyDown={handleKey}
    >
      {/* Left fade */}
      {!(dynamicBaseSets === 1 && atStart) && (
        <div
          aria-hidden="true" // decorative
          className="pointer-events-none absolute left-0 top-0 h-full w-[10px] z-10"
          style={{
            background:
              "linear-gradient(to right, var(--color-stone-900), transparent)",
          }}
        />
      )}
      {/* Right fade */}
      {!(dynamicBaseSets === 1 && atEnd) && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 h-full w-[10px] z-10"
          style={{
            background:
              "linear-gradient(to left, var(--color-stone-900), transparent)",
          }}
        />
      )}
      <div
        ref={scrollRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Customer reviews carousel"
        className="no-scrollbar overflow-x-auto py-2"
        style={{
          // Let native momentum stay:
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x",
        }}
      >
        <div ref={contentRef} className="flex space-x-8">
          {reviewSets.map((review, idx) => (
            <div
              key={idx}
              className="review-item flex-none bg-stone-800 text-stone-100 rounded-lg p-6 shadow w-[16rem] sm:w-auto sm:min-w-[18rem] sm:max-w-xs whitespace-normal text-left select-none text-[16px]"
            >
              <StarRating value={review.rating} />
              <p className="mt-2 text-[16px] italic whitespace-normal text-left select-none line-clamp-2">
                "{review.text}"
              </p>
              <p className="mt-3 font-semibold whitespace-normal text-left select-none text-[16px]">
                {review.name}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
