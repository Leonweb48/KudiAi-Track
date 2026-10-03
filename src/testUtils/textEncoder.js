/* global globalThis */
// jsdom has no TextEncoder/TextDecoder, and jsPDF's PNG decoder needs them as soon as it loads. Import this FIRST in a
// test file (ES imports run before the file's own code, so setting them inline comes too late).
import { TextEncoder, TextDecoder } from "util";
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
