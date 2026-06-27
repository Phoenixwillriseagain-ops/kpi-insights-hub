import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Derive the router basepath from the <base> tag we emit in the SPA shell.
// This allows the same build to work at the domain root, at a GitHub Pages
// project subpath (/<repo>/), or any other nested publish base.
// For SSR or when <base> is unavailable, fall back to '/'.
const getBasepath = (): string => {
  if (typeof document === "undefined") return "/";
  try {
    const baseElement = document.querySelector("base");
    const baseHref = baseElement?.getAttribute("href") || "./";

    // If href is exactly './', we're at the root
    if (baseHref === "./") return "/";

    // Convert relative href to absolute pathname
    const url = new URL(baseHref, window.location.href);
    const pathname = url.pathname;
    return pathname.endsWith("/") ? pathname : pathname + "/";
  } catch {
    return "/";
  }
};

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    basepath: getBasepath(),
  });

  return router;
};
