import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"; // tailwind pre-flight + custom styles
import "./styles/accessibility.css"; // global focus outline

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
