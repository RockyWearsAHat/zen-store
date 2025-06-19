import { useCart } from "../context/CartContext";
import ImageGallery from "../components/ImageGallery";
import {
  FaStar,
  FaRegStar,
  FaRegStarHalfStroke,
  FaChevronDown,
} from "react-icons/fa6"; // + icons
import { useState, useRef, useEffect } from "react"; // ↞ new (for hover logic)
import { IoCheckmark } from "react-icons/io5";
import { catalogue } from "../lib/catalogue";
import { postTikTokEvent } from "../lib/tiktokClient"; // ← add

/* small helper reused from ReviewsCarousel */
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
                ? "text-brand" /* brand colour */
                : half
                ? "text-brand" /* brand colour */
                : "text-gray-300"
            }
          >
            {full ? (
              <FaStar size={14} />
            ) : half ? (
              <FaRegStarHalfStroke size={14} />
            ) : (
              <FaRegStar size={14} />
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ---------- hover dropdown like Amazon (updated) ---------- */
function RatingBreakdown({
  rating,
  data,
  onSelect,
}: {
  rating: number;
  data: { stars: number; percent: number }[];
  onSelect: (stars: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);
  const dropdownId = "rating-breakdown-dropdown";
  const componentRootRef = useRef<HTMLDivElement>(null); // Ref for the entire component
  const triggerRef = useRef<HTMLDivElement>(null); // Ref for the trigger element
  const dropdownContentRef = useRef<HTMLDivElement>(null); // Ref for the dropdown content area

  const enter = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };

  const openDropdownAndFocusFirstItem = () => {
    setOpen(true);
    // Defer focus until after the next render cycle when items are visible and focusable
    requestAnimationFrame(() => {
      const firstButton = dropdownContentRef.current?.querySelector(
        'button[tabindex="0"]'
      );
      (firstButton as HTMLElement)?.focus();
    });
  };

  const closeDropdownAndFocusTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) {
        closeDropdownAndFocusTrigger();
      } else {
        openDropdownAndFocusFirstItem();
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      closeDropdownAndFocusTrigger();
    }
  };

  const handleDropdownItemKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // Prevent trigger's Escape handler
      closeDropdownAndFocusTrigger();
    }
    // Future: Could add ArrowUp/ArrowDown navigation here
  };

  const handleComponentBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    // If focus moves outside the component root, close the dropdown
    if (
      open &&
      !componentRootRef.current?.contains(e.relatedTarget as Node | null)
    ) {
      setOpen(false); // Just close, don't try to refocus trigger here
    }
  };

  // Effect to handle mouse leave when dropdown is open (to keep it open if mouse re-enters dropdown content)
  useEffect(() => {
    const rootNode = componentRootRef.current;
    const contentNode = dropdownContentRef.current;

    const handleMouseLeaveComponent = (event: MouseEvent) => {
      if (open && rootNode && !rootNode.contains(event.relatedTarget as Node)) {
        // If mouse leaves component entirely, use the timer logic
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(false), 250);
      }
    };

    const handleMouseEnterContent = () => {
      if (timer.current) clearTimeout(timer.current);
    };

    const handleMouseLeaveContent = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOpen(false), 250);
    };

    rootNode?.addEventListener("mouseleave", handleMouseLeaveComponent);
    contentNode?.addEventListener("mouseenter", handleMouseEnterContent);
    contentNode?.addEventListener("mouseleave", handleMouseLeaveContent);

    return () => {
      rootNode?.removeEventListener("mouseleave", handleMouseLeaveComponent);
      contentNode?.removeEventListener("mouseenter", handleMouseEnterContent);
      contentNode?.removeEventListener("mouseleave", handleMouseLeaveContent);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open]);

  return (
    <div
      ref={componentRootRef}
      onMouseEnter={enter}
      // onMouseLeave is handled by the useEffect above for more precise control
      onBlur={handleComponentBlur} // Handles tabbing away
      className="relative inline-flex items-center gap-2 bg-stone-900"
    >
      {/* Interactive trigger for the dropdown */}
      <div
        ref={triggerRef}
        tabIndex={0}
        role="button"
        aria-expanded={open}
        aria-controls={dropdownId}
        onClick={() =>
          open
            ? closeDropdownAndFocusTrigger()
            : openDropdownAndFocusFirstItem()
        }
        onKeyDown={handleTriggerKeyDown}
        className="inline-flex items-center gap-2 cursor-pointer p-1 -m-1 rounded"
      >
        {/* numeric rating & stars inside hover zone */}
        <span className="text-sm text-gray-600">{rating.toFixed(1)}</span>
        <StarRating value={rating} />
        {/* arrow now on the right, no rotation */}
        <span
          className="cursor-pointer text-gray-600"
          aria-hidden="true" // purely visual
        >
          <FaChevronDown size={14} />
        </span>
      </div>

      {/* animated container – height via grid-row (no fade) */}
      <div
        ref={dropdownContentRef}
        id={dropdownId}
        className="absolute left-0 top-full mt-1 z-10 w-56 overflow-hidden
                   grid transition-[grid-template-rows] duration-200"
        /* minmax(0, …) => row can shrink to exactly 0px */
        style={{
          gridTemplateRows: open ? "minmax(0,1fr)" : "minmax(0,0fr)",
        }}
        // onMouseEnter and onMouseLeave for dropdown content are handled by useEffect
      >
        <div className="bg-stone-900 border rounded-lg shadow-lg p-3 space-y-1">
          {data.map((row) => (
            <button
              key={row.stars}
              onClick={() => {
                onSelect(row.stars);
                closeDropdownAndFocusTrigger();
              }}
              onKeyDown={handleDropdownItemKeyDown}
              tabIndex={open ? 0 : -1} // Dynamic tabIndex
              className="flex items-center w-full text-left gap-2 hover:bg-stone-700 rounded px-2 py-1"
            >
              <span className="w-16 text-xs">{row.stars} stars</span>
              <div className="flex-1 h-3 bg-gray-200 rounded overflow-hidden relative">
                <div
                  className="bg-brand absolute inset-y-0 left-0 rounded"
                  style={{ width: `${row.percent}%` }}
                />
              </div>
              <span className="w-8 text-right text-xs">{row.percent}%</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
/* ---------- end dropdown ---------- */

const sku = "desktop-fountain";
const product = {
  id: sku,
  title: catalogue[sku].title,
  price: catalogue[sku].price,
  rating: 4.7,
  images: [
    "/Main.avif",
    "/Secondary.avif",
    "/AnotherView.avif",
    "/WithCables.avif",
    "/Dimensions.avif",
    "/WhiteBackground.avif",
  ],
};

const trackPixel = (name: string, props: Record<string, any> = {}) => {
  if (typeof window !== "undefined" && window.ttq) {
    window.ttq.track(name, props);
  }
  postTikTokEvent({ event: name, properties: props });
};

export default function ProductPage() {
  const { addItem } = useCart();
  const [isAdding, setIsAdding] = useState(false);
  const [showAdded, setShowAdded] = useState(false);

  useEffect(() => {
    trackPixel("ViewContent", {
      content_id: product.id,
      content_name: product.title,
      content_type: "product",
      currency: "USD",
      value: product.price, // ← required value
      contents: [
        {
          content_id: product.id,
          content_name: product.title,
          quantity: 1,
        },
      ],
    });
  }, []);

  function handleAddToCart() {
    setIsAdding(true);
    addItem({
      id: product.id,
      title: product.title,
      price: product.price, // now 159.99 from catalogue
      quantity: 1,
      image: product.images[0],
    });
    setShowAdded(true);
    setTimeout(() => {
      setIsAdding(false);
      setShowAdded(false);
    }, 2000);
  }

  return (
    <section
      className="
        bg-stone-900 text-stone-100
        pt-20 pb-12 px-4 sm:px-6 md:px-8   /* extra padding instead of lift */
        flex flex-col lg:flex-row
        gap-8 lg:gap-12
        items-start max-w-6xl mx-auto
        overflow-visible 
      "
    >
      {/* limit gallery size & center on small screens */}
      {/* Modified wrapper for ImageGallery: removed overflow-x-auto, added p-2 */}
      <div className="flex-1 w-full max-w-lg mx-auto lg:mx-0 p-2">
        <ImageGallery images={product.images} className="w-full h-auto" />
      </div>

      {/* make text section share the same max width when stacked */}
      <div className="flex-1 w-full max-w-lg mx-auto lg:mx-0">
        <h2 className="text-4xl font-bold mb-4">{product.title}</h2>

        {/* price */}
        <p className="text-2xl text-brand mb-2">${product.price.toFixed(2)}</p>

        {/* rating row  +  dropdown trigger */}
        <div className="mb-6">
          <RatingBreakdown
            rating={product.rating}
            data={[
              { stars: 5, percent: 65 },
              { stars: 4, percent: 25 },
              { stars: 3, percent: 6 },
              { stars: 2, percent: 3 },
              { stars: 1, percent: 1 },
            ]}
            onSelect={(s) => console.log(`filter reviews: ${s} stars`)}
          />
        </div>

        <p className="mb-8 text-stone-300">
          Bring tranquillity to your workspace. The ZenFlow™ fountain features a
          whisper‑quiet pump, soft LED lighting and premium ceramic finish —
          perfect for stress relief and décor.
        </p>
        <button
          onClick={handleAddToCart}
          disabled={isAdding}
          aria-label={showAdded ? "Item added to cart" : "Add item to cart"}
          className="w-full lg:w-auto bg-brand text-slate-900 font-bold px-8 py-4 rounded-lg shadow border-1 hover:cursor-pointer hover:shadow-lg transition"
        >
          {showAdded ? (
            <span className="inline-flex items-center gap-2">
              <IoCheckmark /> Item Added To Cart
            </span>
          ) : (
            "Add to Cart"
          )}
        </button>
      </div>
    </section>
  );
}
