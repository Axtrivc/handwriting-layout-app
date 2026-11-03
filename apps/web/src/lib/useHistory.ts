import { useRef } from "react";
import type { TextObject } from "@hw-layout/shared";
import { HistoryStore } from "./historyStore.js";

/** Call push before each edit; undo/redo capture the current state for the inverse operation. */
export function useHistory() {
  const store = useRef(new HistoryStore<TextObject[]>());
  return store.current;
}
