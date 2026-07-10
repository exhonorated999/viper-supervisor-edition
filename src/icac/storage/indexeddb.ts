// Fallback adapter — keeps the ICAC index inside the browser's IndexedDB on this
// machine. Used when the File System Access API is unavailable/denied. Data still
// never leaves the machine; export/import to a .json file is offered in the UI.
// ---------------------------------------------------------------------------

import type { IcacIndex } from "../types";
import { emptyIndex } from "../types";
import { idbGet, idbSet } from "./idb";
import { setIcacLocationLabel } from "../config";
import type { IcacStorage } from "./index";

const INDEX_KEY = "index";
const LABEL = "In-browser database (this machine)";

export const indexedDbStorage: IcacStorage = {
  kind: "indexeddb",

  isAvailable() {
    return typeof indexedDB !== "undefined";
  },

  currentLocation() {
    try { return localStorage.getItem("viper.supervisor.icac.location"); } catch { return null; }
  },

  async hasLocation() {
    return (await idbGet<IcacIndex>(INDEX_KEY)) != null || this.currentLocation() != null;
  },

  async chooseLocation() {
    // No OS picker in fallback mode — just confirm the in-browser location.
    setIcacLocationLabel(LABEL);
    return LABEL;
  },

  async clearLocation() {
    setIcacLocationLabel(null);
  },

  async readIndex() {
    return (await idbGet<IcacIndex>(INDEX_KEY)) ?? emptyIndex();
  },

  async writeIndex(ix: IcacIndex) {
    await idbSet(INDEX_KEY, { ...ix, updated_at: new Date().toISOString() });
  },
};
