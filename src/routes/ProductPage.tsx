import { useCart } from "../context/CartContext";
import ImageGallery from "../components/ImageGallery";

const product = {
  id: "desktop-fountain",
  title: "ZenFlow™ Desktop Fountain",
  price: 109.99,
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

  return (
    <section className="p-8 flex flex-col md:flex-row gap-12 items-start max-w-5xl mx-auto">
      <ImageGallery images={product.images} className="flex-1" />

      <div className="flex-1">
        <h2 className="text-4xl font-bold mb-4">{product.title}</h2>
        <p className="text-2xl text-brand mb-6">${product.price.toFixed(2)}</p>
        <p className="mb-8 text-gray-700">
          Bring tranquillity to your workspace. The ZenFlow™ fountain features a
          whisper‑quiet pump, soft LED lighting and premium ceramic finish —
          perfect for stress relief and décor.
        </p>
        <button
          onClick={() =>
            addItem({
              id: product.id,
              title: product.title,
              price: product.price,
              quantity: 1,
            })
          }
          className="bg-brand text-gray-900 font-semibold px-8 py-4 rounded-lg
             shadow-lg outline-2 outline-white/80
             hover:opacity-90 transition focus:ring-4 focus:ring-white/40"
        >
          Add to Cart
        </button>
      </div>
    </section>
  );
}
