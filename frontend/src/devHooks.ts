// Development builds expose the stores on `window.__nestboard` so end-to-end
// tests (and you, in the browser console) can inspect state. Production
// builds never call `installDevHooks`, so this is stripped out.

import { useAccessStore } from "./store/accessStore";
import { useDiagramStore } from "./store/diagramStore";
import { useDocumentStore } from "./store/documentStore";
import { useViewStore } from "./store/viewStore";

const hooks = {
  diagramStore: useDiagramStore,
  viewStore: useViewStore,
  documentStore: useDocumentStore,
  accessStore: useAccessStore,
};

declare global {
  interface Window {
    __nestboard?: typeof hooks;
  }
}

export function installDevHooks() {
  window.__nestboard = hooks;
}
