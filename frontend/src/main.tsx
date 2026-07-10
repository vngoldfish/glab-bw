import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { UiDialogProvider } from "./components/UiDialog";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <UiDialogProvider>
        <App />
      </UiDialogProvider>
    </BrowserRouter>
  </StrictMode>,
);