import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Derive the router basepath from the document's <base href> so the same
// build works at the domain root, at a GitHub Pages project subpath
// (/<repo>/), or any other nested publish base. document.baseURI reflects
// the <base href="./"> we emit in the SPA shell, resolved against the
// served URL — so on /repo/ it becomes https://host/repo/ and we extract
// '/repo/'. SSR has no document; fall back to '/'.
const getBasepath = (): string => {
  if (typeof document === "undefined") return "/";
  try {
    const pathname = new URL(document.baseURI).pathname;
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
