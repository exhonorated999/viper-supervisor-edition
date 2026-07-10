// Custom pdf.js worker entry. Installs the Uint8Array hex/base64 shim in the
// WORKER global scope (where pdf.js v6 actually calls toHex/fromBase64) BEFORE
// the real pdf.js worker registers its message handler on `self`. Loaded by
// pdftext.ts via Vite's `?worker` import and handed to pdf.js as workerPort.
// ---------------------------------------------------------------------------
import "../../polyfills/uint8-hex-base64";
import "pdfjs-dist/build/pdf.worker.min.mjs";
