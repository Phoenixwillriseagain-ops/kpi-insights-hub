import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// On GitHub Pages, we're served from /kpi-insights-hub/
// This basepath is used by TanStack Router for route matching
const BASEPATH = "/kpi-insights-hub/";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    basepath: BASEPATH,
  });

  return router;
};
