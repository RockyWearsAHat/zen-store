import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FaRegStarHalfStroke, FaStar, FaRegStar } from "react-icons/fa6";

/** very small helper */
function StarRating({ value }: { value: number }) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((i) => {
        const full = value >= i;
        const half = !full && value >= i - 0.5;
        return (
          <span
            key={i}
            className={
              full
                ? "text-yellow-400"
                : half
                ? "text-yellow-400/60"
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
    text: "The soft water sound keeps me calm on stressful days.",
  },
  {
    name: "Marcus L.",
    rating: 5,
    text: "Looks premium, feels premium – worth every cent!",
  },
  {
    name: "Priya S.",
    rating: 4,
    text: "Really helped me focus while studying for exams.",
  },
  {
    name: "Daniel T.",
    rating: 4.5,
    text: "Pump is almost silent, exactly what I needed for video calls.",
  },
  {
    name: "Jin‑Ho K.",
    rating: 5,
    text: "Arrived quickly and was super easy to set up.",
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
  {
    name: "Olivia P.",
    rating: 4.5,
    text: "Great gift idea – bought two already.",
  },
  {
    name: "George B.",
    rating: 4,
    text: "Wish I’d bought one sooner.",
  },
];

const x3 = [...reviews, ...reviews, ...reviews];

export default function ReviewsCarousel() {
  const ref = useRef<HTMLDivElement>(null);
  const seg = useRef(0); // width of ONE review set
  const [pause, setPause] = useState(false);
  const speed = 0.25; // px / frame

  /* measure once DOM is ready */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    seg.current = el.scrollWidth / 3;
    el.scrollLeft = seg.current; // start inside middle copy
  }, []);

  /* exact modulo clamp — always keeps scrollLeft inside (seg .. 2*seg) */
  const clamp = (el: HTMLDivElement) => {
    const s = seg.current;
    el.scrollLeft = ((((el.scrollLeft - s) % s) + s) % s) + s;
  };

  /* auto‑scroll loop */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let id = 0;
    const step = () => {
      if (!pause) el.scrollLeft += speed;
      clamp(el); // <- new modulo clamp
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [pause]);

  /* native scroll listener – wheel / drag / touchpad */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => clamp(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      ref={ref}
      className="no-scrollbar overflow-x-auto flex space-x-8 py-2"
      onMouseEnter={() => setPause(true)}
      onMouseLeave={() => setPause(false)}
    >
      {x3.map((r, i) => (
        <div
          // add whitespace-normal & text-left so card content wraps and is left‑aligned
          className="inline-block bg-white text-gray-900 rounded-lg p-6 shadow min-w-[16rem] max-w-xs whitespace-normal text-left overflow-y-visible"
          key={i}
        >
          <StarRating value={r.rating} />
          {/* force wrapping & left alignment for review text */}
          <p className="mt-2 text-sm italic whitespace-normal text-left">
            “{r.text}”
          </p>
          {/* force wrapping & left alignment for name */}
          <p className="mt-3 font-semibold whitespace-normal text-left">
            {r.name}
          </p>
        </div>
      ))}
    </div>
  );
}
