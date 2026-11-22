/** Monta a interface React da ilha (visual do "outro modelo") no #root. */
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

export function montarUI(): void {
  const raiz = document.getElementById("root");
  if (!raiz) throw new Error("Elemento #root não encontrado no index.html");
  createRoot(raiz).render(<App />);
}
