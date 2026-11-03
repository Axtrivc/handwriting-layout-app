import type { CanvasProject } from '@hw-layout/shared';

export interface DocumentState {
  project: CanvasProject;
  generation: number;
  revision: number;
  savedRevision: number;
}
export type DocumentAction =
  | { type: 'edit'; generation: number; update: (project: CanvasProject) => CanvasProject; at: string }
  | { type: 'select'; pageId: string }
  | { type: 'replace'; project: CanvasProject }
  | { type: 'saved'; generation: number; revision: number };
export function documentState(project: CanvasProject): DocumentState {
  return { project, generation: 0, revision: 0, savedRevision: 0 };
}
export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case 'replace': return { ...documentState(action.project), generation: state.generation + 1 };
    case 'select':
      return state.project.pages.some(p => p.id === action.pageId)
        ? { ...state, project: { ...state.project, activePageId: action.pageId } } : state;
    case 'saved':
      return action.generation === state.generation && action.revision <= state.revision
        ? { ...state, savedRevision: Math.max(state.savedRevision, action.revision) } : state;
    case 'edit': {
      // Async edits from a replaced document must never affect the new document.
      if (action.generation !== state.generation) return state;
      const project = action.update(state.project);
      if (project === state.project) return state;
      return { ...state, project: { ...project, updatedAt: action.at }, revision: state.revision + 1 };
    }
  }
}
