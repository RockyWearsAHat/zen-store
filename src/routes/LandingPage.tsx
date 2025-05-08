import { Link } from "react-router-dom";
import ReviewsCarousel from "../components/ReviewsCarousel";
import { useEffect, useState, useRef } from "react";

export default function LandingPage() {
  /* ─────────────── hero image infinite carousel ─────────────── */
  const heroImages = ["/Main.avif", "/Secondary.avif", "/WithCables.avif"];
  const seg = heroImages.length; // size of one logical set
  const slides = [...heroImages, ...heroImages, ...heroImages]; // x3
  const [idx, setIdx] = useState(seg); // centre copy
  const [busy, setBusy] = useState(false); // block rapid clicks
  const trackRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);

  /* 5‑s auto‑advance. If the slide is still animating (`busy`), reschedule
     until idle so auto‑scroll never stops. */
  const schedule = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (busy) {
        schedule(); // try again once current motion ends
      } else {
        next();
      }
    }, 5000);
  };

  // restart timer whenever index changes or animation lock toggles
  useEffect(() => {
    schedule();
    return () => clearTimeout(timer.current);
  }, [idx, busy]);

  /* ---------- transition end handler ---------- */
  const onTransEnd = () => {
    let newIdx = idx;
    if (idx >= seg * 2) newIdx = idx - seg; // right edge
    else if (idx < seg) newIdx = idx + seg; // left edge

    if (newIdx !== idx && trackRef.current) {
      const t = trackRef.current;

      /* 1️⃣  jump instantly (no animation) */
      t.style.transition = "none";
      t.style.transform = `translateX(-${newIdx * 100}%)`;
      // force re‑flow so the browser applies the instant move
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      t.offsetHeight;

      /* 2️⃣  restore transition for the next animated slide */
      t.style.transition = "transform 700ms ease-in-out";
      setIdx(newIdx); // keep React state in sync
    }

    setBusy(false); // unlock after everything
  };

  /* ---------- helpers ---------- */
  const next = () => {
    if (busy) return;
    setBusy(true);
    setIdx((i) => i + 1);
  };
  const prev = () => {
    if (busy) return;
    setBusy(true);
    setIdx((i) => i - 1);
  };
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const { left, width } = e.currentTarget.getBoundingClientRect();
    (e.clientX - left > width / 2 ? next : prev)();
  };

  /* ---------- JSX ---------- */
  return (
    <div className="flex flex-col bg-stone-900 text-stone-100">
      {/* Hero */}
      <section className="bg-stone-900">
        <div
          className="
            w-full max-w-none                /* full width < xl */
            xl:max-w-6xl                     /* constrain on xl+ */
            mx-auto
            px-6 xl:px-6                     /* regular padding  */
            py-[5rem]
            flex flex-col gap-12             /* default stack    */
            xl:grid xl:grid-cols-2 xl:gap-12 /* side-by-side ≥xl */
          "
        >
          {/* headline & CTA */}
          <div className="order-2 xl:order-1 text-center xl:text-left flex flex-col justify-between h-full">
            <h1 className="text-5xl md:text-6xl font-extrabold leading-tight mb-6 text-stone-100">
              Find Your Flow with the{" "}
              <span className="underline text-brand">ZenFlow™ Fountain</span>
            </h1>
            <p className="text-lg md:text-xl mb-8 max-w-xl mx-auto text-stone-300">
              Gentle water, soft light, and modern ceramic
              decorations—everything you need to turn your desk into a mini
              retreat. Take a deep breath in, feel tranquility wash over you,
              and let your productivity flow.
            </p>
            <Link
              className="inline-block w-full text-center bg-brand text-stone-900 font-semibold
                         px-8 py-[1.105rem] rounded-lg transition hover:scale-[102%]
                         mt-8 xl:mt-auto"
              to="/product"
            >
              Buy Now – $109.99
            </Link>
          </div>

          {/* infinite-scrolling & clickable hero images */}
          <div
            className="relative order-1 xl:order-2
                       aspect-square
                       h-96 md:h-[500px] xl:h-auto
                       w-auto mx-auto
                       overflow-hidden rounded-xl shadow-lg
                       cursor-pointer"
            onClick={handleClick}
          >
            <div
              ref={trackRef}
              onTransitionEnd={onTransEnd}
              className="flex w-full h-full transition-transform duration-700 ease-in-out"
              style={{ transform: `translateX(-${idx * 100}%)` }}
            >
              {slides.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt="Desktop fountain hero"
                  className="w-full h-full flex-shrink-0
                             object-cover object-center   /* fill, no gutter */
                             rounded-xl" /* visible radius   */
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        /* lift section upward on small/medium, but not on large screens */
        className="bg-stone-900 py-20 -mt-12 md:-mt-24 lg:mt-0"
      >
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-12">
          {[
            {
              icon: "💧",
              title: "Soothing Waterfall",
              desc: "Continuous and calming flow. Built for relaxation.",
            },
            {
              icon: "🔇",
              title: "Whisper‑Quiet Pump",
              desc: "Engineered for near‑silent operation—perfect for your office.",
            },
            {
              icon: "🌿",
              title: "Incense Holder",
              desc: "Create a serene atmosphere with your favorite scents.",
            },
          ].map((f) => (
            <div
              key={f.title}
              /* force dark copy inside white card */
              className="bg-stone-800 text-stone-100 rounded-xl p-8 shadow hover:shadow-lg
                         border border-stone-700 transition text-center"
            >
              <div className="text-4xl mb-4">{f.icon}</div>
              <h3 className="text-xl font-bold mb-2">{f.title}</h3>
              <p className="text-stone-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="text-white py-16 text-center overflow-y-visible">
        {/* customer reviews loop */}
        <div className="max-w-6xl mx-auto mb-10 px-6 overflow-y-visible">
          <ReviewsCarousel />
        </div>
      </section>
    </div>
  );
}
