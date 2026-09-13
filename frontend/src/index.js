import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Open Sauce is SIL OFL, so unlike the rest of the catalogue it ships with
// the app instead of being fetched from Google Fonts. Latin only, and only
// the weights the weight picker offers — the browser downloads a face just
// when something is actually set in it.
import "@fontsource/open-sauce-sans/latin-400.css";
import "@fontsource/open-sauce-sans/latin-500.css";
import "@fontsource/open-sauce-sans/latin-600.css";
import "@fontsource/open-sauce-sans/latin-700.css";
import "@fontsource/open-sauce-sans/latin-800.css";
import "@fontsource/open-sauce-sans/latin-900.css";
import "@/index.css";
import App from "@/App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
