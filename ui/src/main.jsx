import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ToastProvider } from "./components/ui.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
