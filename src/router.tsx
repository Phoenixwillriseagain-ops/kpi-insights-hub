import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Derive the router basepath from the pathname.
// On GitHub Pages project sites, the URL is: https://host/repo/...
// We need to extract /repo/ as the basepath.
//
// Strategy:
// 1. For SSR (no document), return "/"
// 2. For client: analyze window.location.pathname to detect the repo subpath
// 3. The <base href="./"> in our SPA shell handles relative asset resolution,
//    but TanStack Router needs the actual path prefix for routing to work.
const getBasepath = (): string => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "/";
  }

  try {
    const pathname = window.location.pathname;
    
    // Split pathname into segments: ["", "kpi-insights-hub", ""] (or just ["", ""])
    const segments = pathname.split("/").filter(Boolean);
    
    // If we have 0 segments, we're at the domain root → basepath is "/"
    if (segments.length === 0) {
      return "/";
    }
    
    // If we have 1+ segments, the first segment is likely the repo name on GitHub Pages
    // Return "/repo/" as the basepath
    return "/" + segments[0] + "/";
  } catch (error) {
    console.error("Failed to determine basepath:", error);
    return "/";
  }
};

export const getRouter = () => {
  const queryClient = new QueryClient();

  const basepath = getBasepath();
  
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    basepath,
  });

  return router;
};
