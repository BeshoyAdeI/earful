/** Lets code outside React (stores, toasts) open a page: App hands over the router's navigate function. */
let go: ((to: string) => void) | null = null;

export const setNavigator = (navigate: ((to: string) => void) | null) => {
  go = navigate;
};

export const goTo = (to: string) => go?.(to);
