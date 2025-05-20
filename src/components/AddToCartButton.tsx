import { useState } from "react";
import { IoCheckmark } from "react-icons/io5";
import { useCart } from "../context/CartContext";

export default function AddToCartButton({ product }: { product: any }) {
  const { addItem } = useCart();
  const [isAdding, setIsAdding] = useState(false);
  const [showAdded, setShowAdded] = useState(false);

  const handleAddToCart = () => {
    setIsAdding(true);
    addItem(product);
    setShowAdded(true);
    setTimeout(() => {
      setIsAdding(false);
      setShowAdded(false);
    }, 2000);
  };

  return (
    <button onClick={handleAddToCart} disabled={isAdding}>
      {showAdded ? (
        <>
          <IoCheckmark /> Item Added To Cart
        </>
      ) : (
        "Add To Cart"
      )}
    </button>
  );
}
