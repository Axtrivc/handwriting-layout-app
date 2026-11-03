import { useCallback, useReducer } from 'react';
import { createEmptyProject, nowISO, type CanvasPage, type CanvasProject } from '@hw-layout/shared';
import { documentReducer, documentState } from './documentState.js';

/** One write boundary for persisted content, navigation and saved-state tracking. */
export function useDocument() {
  const [state, dispatch] = useReducer(documentReducer, undefined, () => documentState(createEmptyProject()));
  const { generation, revision } = state;
  const edit = useCallback((update: (p: CanvasProject) => CanvasProject) => {
    dispatch({ type: 'edit', generation, update, at: nowISO() });
  }, [generation]);
  const updatePage = useCallback((id: string, update: (p: CanvasPage) => CanvasPage) => {
    edit(p => {
      if (!p.pages.some(page => page.id === id)) return p;
      return { ...p, pages: p.pages.map(page => page.id === id ? update(page) : page) };
    });
  }, [edit]);
  const selectPage = useCallback((pageId: string) => dispatch({ type: 'select', pageId }), []);
  const replace = useCallback((project: CanvasProject) => dispatch({ type: 'replace', project }), []);
  const markSaved = useCallback(() => dispatch({ type: 'saved', generation, revision }), [generation, revision]);
  return { project: state.project, generation, dirty: revision !== state.savedRevision,
    edit, updatePage, selectPage, replace, markSaved };
}
