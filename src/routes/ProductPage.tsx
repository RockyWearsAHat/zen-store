import { useCart } from "../context/CartContext";
import ImageGallery from "../components/ImageGallery";
import {
  FaStar,
  FaRegStar,
  FaRegStarHalfStroke,
  FaChevronDown,
} from "react-icons/fa6"; // + icons
import { useState, useRef } from "react"; // ↞ new (for hover logic)
import { IoCheckmark } from "react-icons/io5";

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
                ? "text-yellow-400"
                : half
                ? "text-yellow-400"
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

  const enter = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const leave = () => {
    timer.current = setTimeout(() => setOpen(false), 250); // small grace period
  };

  return (
    <div
      onMouseEnter={enter}
      onMouseLeave={leave}
      className="relative inline-flex items-center gap-2 bg-stone-900"
    >
      {/* numeric rating & stars inside hover zone */}
      <span className="text-sm text-gray-600">{rating.toFixed(1)}</span>
      <StarRating value={rating} />
      {/* arrow now on the right, no rotation */}
      <span className="cursor-pointer text-gray-600">
        <FaChevronDown size={14} />
      </span>

      {/* animated container – height via grid-row (no fade) */}
      <div
        className="absolute left-0 top-full mt-1 z-10 w-56 overflow-hidden
                   grid transition-[grid-template-rows] duration-200"
        /* minmax(0, …) => row can shrink to exactly 0px */
        style={{
          gridTemplateRows: open ? "minmax(0,1fr)" : "minmax(0,0fr)",
        }}
        onMouseEnter={enter}
        onMouseLeave={leave}
      >
        <div className="bg-stone-900 border rounded-lg shadow-lg p-3 space-y-1">
          {data.map((row) => (
            <button
              key={row.stars}
              onClick={() => onSelect(row.stars)}
              className="flex items-center w-full text-left gap-2 hover:bg-stone-700 rounded px-2 py-1"
            >
              <span className="w-16 text-xs">{row.stars} stars</span>
              <div className="flex-1 h-3 bg-gray-200 rounded overflow-hidden relative">
                <div
                  className="bg-yellow-400 absolute inset-y-0 left-0 rounded"
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

const product = {
  id: "desktop-fountain",
  title: "ZenFlow™ Desktop Fountain",
  price: 109.99,
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

export default function ProductPage() {
  const { addItem } = useCart();
  const [isAdding, setIsAdding] = useState(false);
  const [showAdded, setShowAdded] = useState(false);

  function handleAddToCart() {
    setIsAdding(true);
    addItem({
      id: product.id,
      title: product.title,
      price: product.price,
      quantity: 1,
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
      <div className="flex-1 w-full max-w-lg mx-auto lg:mx-0 overflow-x-auto">
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
