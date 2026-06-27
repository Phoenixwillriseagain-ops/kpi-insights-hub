import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// On GitHub Pages, served from /kpi-insights-hub/
const BASEPATH = "/kpi-insights-hub/";

export const getRouter = () => {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    basepath: BASEPATH,
  });
};
