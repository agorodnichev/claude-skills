import type { LogFeed } from './log-feed';

// TODO: show the feed live in `container`.
// - newest line at the bottom
// - keep at most the last 10,000 lines
// - follow the bottom, unless the user has scrolled up to read older lines
// - return a function that stops everything when the view is removed
export function mountLogView(container: HTMLElement, feed: LogFeed): () => void {
  return () => {};
}
