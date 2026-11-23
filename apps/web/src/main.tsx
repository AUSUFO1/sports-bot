import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme, getTheme } from "./theme";
import "./style.css";

applyTheme(getTheme()); // before first paint, so there is no flash of the wrong colours
createRoot(document.getElementById("root")!).render(<App />);
