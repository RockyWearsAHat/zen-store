import { Link } from "react-router-dom";
import ReviewsCarousel from "../components/ReviewsCarousel";
import { useEffect, useState, useRef } from "react";

export default function LandingPage() {
  // Image sources
  const heroImages = [
    "/Video.mp4",
    "/Secondary.avif",
    "/WithCables.avif",
    "/Main.avif", // Using .avif as per correction comment in original
  ];

  // For infinite scrolling, we need one before and one after
  const slides = [
    heroImages[heroImages.length - 1],
    ...heroImages,
    heroImages[0],
  ];

  const [currentIndex, setCurrentIndex] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [skipAnimation, setSkipAnimation] = useState(false);
  const autoScrollTimer = useRef<number | null>(null);
  const playTimerRef = useRef<number | null>(null); // deferred play
  const SAFE_PLAY_DELAY = 150; // ms – long enough for CSS
  // Keep track of the slide we are leaving so we can keep it visible during the animation
  const prevIndexRef = useRef(currentIndex);

  // Reset position instantly when reaching edges
  useEffect(() => {
    if (!skipAnimation) return;

    const timeout = setTimeout(() => {
      setSkipAnimation(false);
    }, 50);

    return () => clearTimeout(timeout);
  }, [skipAnimation]);

  // Start auto-scrolling timer
  const startAutoScroll = () => {
    stopAutoScroll();
    autoScrollTimer.current = window.setTimeout(() => {
      goToSlide(currentIndex + 1);
    }, 5000);
  };

  // Stop auto-scrolling timer
  const stopAutoScroll = () => {
    if (autoScrollTimer.current) {
      clearTimeout(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
    // also clear any pending play-after-scroll timer
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
  };

  // Handle slide transition end
  const handleTransitionEnd = () => {
    setIsTransitioning(false);

    // Handle the loop points
    if (currentIndex === 0) {
      setSkipAnimation(true);
      setCurrentIndex(slides.length - 2);
    } else if (currentIndex === slides.length - 1) {
      setSkipAnimation(true);
      setCurrentIndex(1);
    }
  };

  // Navigate to a specific slide
  const goToSlide = (index: number) => {
    if (isTransitioning && currentIndex === index) return;
    prevIndexRef.current = currentIndex;

    const targetSrc = slides[index]; // what we are scrolling TO

    // Pause all videos and rewind only the target src (handles duplicate pair)
    slides.forEach((slideSrc, i) => {
      if (slideSrc.endsWith(".mp4")) {
        const video = document.getElementById(
          `video-slide-${i}`
        ) as HTMLVideoElement | null;
        if (!video) return;

        if (!video.paused) video.pause();

        // Rewind when this slide shares the same src as the target (covers duplicate)
        if (slideSrc === targetSrc) {
          const doRewind = () => {
            if (video.currentTime !== 0) video.currentTime = 0;
            if (!video.paused) video.pause();
          };
          if (video.readyState >= HTMLMediaElement.HAVE_METADATA) doRewind();
          else
            video.addEventListener("loadedmetadata", doRewind, { once: true });
        }
      }
    });

    stopAutoScroll(); // also clears play timers
    setIsTransitioning(true);
    setCurrentIndex(index);
  };

  // Previous slide
  const goToPrevSlide = () => {
    goToSlide(currentIndex - 1);
  };

  // Next slide
  const goToNextSlide = () => {
    goToSlide(currentIndex + 1);
  };

  // Handle click navigation
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 2) {
      goToPrevSlide();
    } else {
      goToNextSlide();
    }
  };

  // Handle touch events
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;

    const touchEndX = e.changedTouches[0].clientX;
    const diffX = touchEndX - touchStartX.current;

    if (Math.abs(diffX) > 50) {
      if (diffX > 0) {
        goToPrevSlide();
      } else {
        goToNextSlide();
      }
    }

    touchStartX.current = null;
  };

  // Effect 1: Prepare ALL videos during transitions or animation skips
  useEffect(() => {
    if (isTransitioning || skipAnimation) {
      slides.forEach((slideSrc, idx) => {
        if (slideSrc.endsWith(".mp4")) {
          const videoEl = document.getElementById(
            `video-slide-${idx}`
          ) as HTMLVideoElement | null;
          if (videoEl) {
            // no special visibility changes – translateX already keeps slides
            // off-screen while scrolling.

            // Always pause any video that's playing
            if (!videoEl.paused) {
              videoEl.pause();
            }

            // If skipAnimation is true (typically for loop jumps where goToSlide isn't called),
            // and this is the target video, ensure its currentTime is reset.
            if (idx === currentIndex && skipAnimation) {
              if (videoEl.readyState >= HTMLMediaElement.HAVE_METADATA) {
                if (videoEl.currentTime !== 0) {
                  videoEl.currentTime = 0;
                }
              } else {
                const handler = () => {
                  if (videoEl.currentTime !== 0) {
                    videoEl.currentTime = 0;
                  }
                  if (!videoEl.paused) {
                    // Ensure pause after time reset
                    videoEl.pause();
                  }
                };
                videoEl.addEventListener("loadedmetadata", handler, {
                  once: true,
                });
              }
            }
            // For general transitions (isTransitioning=true, skipAnimation=false),
            // goToSlide has already handled resetting currentTime for the target slide.
            // For other non-target videos, they are just ensured to be paused.
          }
        }
      });
    }
  }, [currentIndex, isTransitioning, skipAnimation, slides]);

  // Effect 2: Manage playback for stable current slide and image auto-scroll
  useEffect(() => {
    stopAutoScroll();
    if (!isTransitioning && !skipAnimation) {
      slides.forEach((slideSrc, idx) => {
        if (slideSrc.endsWith(".mp4")) {
          const vid = document.getElementById(
            `video-slide-${idx}`
          ) as HTMLVideoElement | null;
          if (vid) {
            // no opacity manipulation
            if (idx !== currentIndex && !vid.paused) {
              vid.pause();
            }
          }
        }
      });

      // Handle the current slide
      if (slides[currentIndex].endsWith(".mp4")) {
        const video = document.getElementById(
          `video-slide-${currentIndex}`
        ) as HTMLVideoElement | null;
        if (video) {
          const playAfterDelay = () => {
            if (video.paused) video.play().catch(console.error);
          };

          const queuePlay = () => {
            playTimerRef.current = window.setTimeout(() => {
              playAfterDelay();
              playTimerRef.current = null;
            }, SAFE_PLAY_DELAY);
          };

          if (video.readyState >= HTMLMediaElement.HAVE_METADATA) queuePlay();
          else {
            video.onloadedmetadata = () => {
              queuePlay();
              video.onloadedmetadata = null;
            };
          }
        }
      } else {
        startAutoScroll();
      }
    }
    return () => stopAutoScroll();
  }, [currentIndex, isTransitioning, skipAnimation, slides]);

  return (
    <div className="flex flex-col bg-stone-900 text-stone-100">
      <section className="bg-stone-900 overflow-hidden">
        <div className="w-full max-w-none xl:max-w-6xl mx-auto px-6 xl:px-6 py-[5rem] flex flex-col gap-12 xl:grid xl:grid-cols-2 xl:gap-12">
          <div className="order-2 xl:order-1 text-center xl:text-left flex flex-col justify-between h-full">
            <h1 className="text-5xl md:text-6xl font-extrabold leading-tight mb-6 text-stone-100">
              Find Your Flow with the{" "}
              <span className="underline text-brand">ZenFlow™ Fountain</span>
            </h1>
            <p className="text-lg md:text-xl mb-8 max-w-xl mx-auto text-stone-300">
              Made with ceramic and wood finishes, this fountain radiates{" "}
              tranquility into your workspace. The soothing sounds of flowing
              water create a calm atmosphere, allowing you to relax or focus.
              The quiet electronics, humidifier, & incense holder allow you to{" "}
              <span className="text-brand font-bold">
                make your space exactly the way you like, for work, meditation,
                or relaxation
              </span>
              .
            </p>
            <Link
              className="inline-block w-full text-center bg-brand text-stone-900 font-semibold
                         px-8 py-[1.105rem] rounded-lg transition hover:scale-[102%]
                         mt-8 xl:mt-auto focus:outline-none focus:ring-none focus:text-stone-900"
              to="/product"
            >
              Buy Now – $109.99
            </Link>
          </div>

          {/* Hero Image Carousel - Fixed styling */}
          <div
            className="relative order-1 xl:order-2 aspect-square w-full mx-auto overflow-hidden rounded-xl shadow-lg cursor-pointer"
            onClick={handleClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div
              className="absolute inset-0 flex"
              style={{
                transform: `translateX(-${
                  currentIndex * (100 / slides.length)
                }%)`,
                transition: skipAnimation
                  ? "none"
                  : "transform 0.5s ease-in-out",
                width: `${slides.length * 100}%`,
              }}
              onTransitionEnd={handleTransitionEnd}
            >
              {slides.map((src, index) => (
                <div
                  key={`slide-${index}`}
                  style={{ width: `${100 / slides.length}%` }}
                  className="relative flex-shrink-0"
                >
                  {src.endsWith(".mp4") ? (
                    <video
                      id={`video-slide-${index}`}
                      className="absolute inset-0 w-full h-full object-cover"
                      muted
                      onEnded={goToNextSlide}
                      playsInline
                      preload="auto"
                      ref={(videoRef) => {
                        if (videoRef) {
                          videoRef.setAttribute("webkit-playsinline", "");
                        }
                      }}
                      style={{ pointerEvents: "none" }}
                      controlsList="nodownload nofullscreen noremoteplayback"
                    >
                      <source src={src} type="video/mp4" />
                    </video>
                  ) : (
                    <img
                      src={src}
                      alt={`Product view ${index}`}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement;
                        img.src = "/fallback-hero.jpg";
                      }}
                    />
                  )}
                </div>
              ))}

              {/* Remove navigation dots */}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES GRID – restore corrupted markup */}
      <section className="bg-stone-900 pt-20 pb-12">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-12">
          {[
            {
              icon: "💧",
              title: "Soothing Waterfall",
              desc: "Continuous and calming flow. Built for relaxation.",
            },
            {
              icon: "🔇",
              title: "Whisper-Quiet Pump",
              desc: "Engineered for near-silent operation—perfect for your office.",
            },
            {
              icon: "🌿",
              title: "Incense Holder",
              desc: "Create a serene atmosphere with your favorite scents.",
            },
          ].map((f) => (
            <div
              key={f.title}
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

      <section className="text-white py-16 text-center">
        <div className="max-w-6xl mx-auto mb-10 px-6">
          <ReviewsCarousel />
        </div>
      </section>
    </div>
  );
}
