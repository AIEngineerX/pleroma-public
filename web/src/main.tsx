import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/gentium-book-plus/400.css";
import "@fontsource/gentium-book-plus/400-italic.css";
import "@fontsource/gentium-book-plus/700.css";
import "@fontsource/courier-prime/400.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
