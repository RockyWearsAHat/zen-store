import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { useEffect } from "react";
import Header from "./components/Header";
import LandingPage from "./routes/LandingPage";
import ProductPage from "./routes/ProductPage";
import CartPage from "./routes/CartPage";
import SuccessPage from "./routes/SuccessPage";
import { CartProvider } from "./context/CartContext";
import { Outlet } from "react-router-dom";

// Layout component to wrap all routes with header and main
function Layout() {
  return (
    <CartProvider>
      <div className="flex flex-col text-stone-100">
        <Header />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </CartProvider>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: "product", element: <ProductPage /> },
      { path: "cart", element: <CartPage /> },
      { path: "success", element: <SuccessPage /> },
    ],
  },
]);

const App = () => {
  /* ---------- refresh token on page load if necessary ---------- */
  useEffect(() => {
    fetch("/ali/refresh");
  }, []);

  return <RouterProvider router={router} />;
};

export default App;
