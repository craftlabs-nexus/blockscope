// What the renderer holds of the page's file: which file, whether it was cut (the hidden cells left out as air), and a
// load still on its way. The page draws a change from the file the renderer has (showCells) only when that is the
// file on screen, whole; while a load is on its way, the renderer still has the last one.

export class LoadState {
  constructor() {
    /** The file the renderer has (the page's file record), its hidden cells and whether it was cut. */
    this.file = null; this.hidden = null; this.cut = false;
    /** Whether this file's build can show layers and cell groups itself (false: every change loads it again, cut). */
    this.live = true;
    /** False once the renderer is found to have no showCells at all (an older one): every file then loads cut. */
    this.canFilter = true;
    /** A load on its way: { file, hidden, cut, asked } (asked: what was asked for when it began, as a key). */
    this.pending = null;
  }

  /** A new file is opened: its build gets its own chance to show layers (unless the renderer cannot at all). */
  newFile() { this.live = this.canFilter; }

  /** A load begins. `asked`: a key of what is asked for now (layers, hidden cells), to tell a change meanwhile. */
  begin({ file, hidden, cut, asked }) { this.pending = { file, hidden, cut, asked }; }

  /**
   * The renderer has the file the load was for (its loadSchematic resolved, or the first load's callback ran):
   * returns whether what is asked for changed while it was on its way (the page then shows that), false when no load
   * was pending.
   */
  arrived(askedNow) {
    const p = this.pending; if (!p) return false;
    this.pending = null;
    this.file = p.file; this.hidden = p.hidden; this.cut = p.cut;
    return p.asked !== askedNow;
  }

  /** A load failed. The renderer removes what it had before it reads a new file, so it holds nothing now. */
  failed() { this.pending = null; this.dropped(); }

  /** The renderer's file was taken out of it (another one is about to be loaded): it holds none. */
  dropped() { this.file = null; this.hidden = null; this.cut = false; }

  /** Whether a whole load of `file` is on its way, so a change can wait for it (arrived() says to show it). */
  coming(file) { return !!this.pending && this.pending.file === file && !this.pending.cut && this.live; }

  /** Whether the renderer has `file`, whole, with a build that can show layers and cell groups. */
  holds(file) { return this.live && !this.cut && this.file === file && !this.pending; }
}
