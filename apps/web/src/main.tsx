import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import "./globals.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("EasySymbols root element is missing.");
}

ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />);
