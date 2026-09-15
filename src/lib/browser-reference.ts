export type BrowserReference = {
  version: 1;
  kind: "owned-preview";
  sessionId: string;
  leaseId: string;
  pageId: string;
  title: string;
  displayUrl: string;
  capturedAt: number;
};
