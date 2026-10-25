// What the renderer holds of the page's file: which file, whether it was cut (the hidden cells left out as air), and a
// load still on its way. The page draws a change from the file the renderer has (showCells) only when that is the
// file on screen, whole; while a load is on its way, the renderer still has the last one.

export class LoadState {
  constructor() {
    /** The file the renderer has (the page's file record) and whether it was cut. */
    this.file = null; this.cut = false;
    /** Whether this file's build can show layers and cell groups itself (false: every change loads it again, cut). */
    this.live = true;
    /** False once the renderer is found to have no showCells at all (an older one): every file then loads cut. */
    this.canFilter = true;
    /** A load on its way: { id, file, cut, asked } (asked: what was asked for when it began, as a key). */
    this.pending = null;
    this.lastId = 0;
  }

  /** A new file is opened: its build gets its own chance to show layers (unless the renderer cannot at all). */
  newFile() { this.live = this.canFilter; }

  /** A load begins; returns its id. `asked`: a key of what is asked for now (layers, hidden cells), to tell a change
   *  made while it is on its way. The page runs loads one at a time, so the last begun is the one the renderer ends with. */
  begin({ file, cut, asked }) { this.pending = { id: ++this.lastId, file, cut, asked }; return this.lastId; }

  /**
   * The renderer has the file load `id` was for (its loadSchematic resolved; the first load's callback passes none):
   * returns whether what is asked for changed while it was on its way (the page then shows that). A load that is not
   * the one pending (an older one, or none) changes nothing and returns false.
   */
  arrived(id, askedNow) {
    const p = this.pending; if (!p || (id !== null && id !== p.id)) return false;
    this.pending = null;
    this.file = p.file; this.cut = p.cut;
    return p.asked !== askedNow;
  }

  /** A load failed. The renderer removes what it had before it reads a new file, so it holds nothing now. */
  failed() { this.pending = null; this.dropped(); }

  /** The renderer's file was taken out of it (another one is about to be loaded): it holds none. */
  dropped() { this.file = null; this.cut = false; }

  /** Whether a whole load of `file` is on its way, so a change can wait for it (arrived() says to show it). */
  coming(file) { return !!this.pending && this.pending.file === file && !this.pending.cut && this.live; }

  /** Whether the renderer has `file`, whole, with a build that can show layers and cell groups. */
  holds(file) { return this.live && !this.cut && this.file === file && !this.pending; }
}
