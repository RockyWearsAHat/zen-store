import { Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import LandingPage from "./routes/LandingPage";
import ProductPage from "./routes/ProductPage";
import CartPage from "./routes/CartPage";
import SuccessPage from "./routes/SuccessPage";
import { CartProvider } from "./context/CartContext";

const App: React.FC = () => {
  return (
    <CartProvider>
      <Header />
      <main className="flex-1 pt-0">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/product" element={<ProductPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/success" element={<SuccessPage />} />
        </Routes>
      </main>
    </CartProvider>
  );
};

export default App;
