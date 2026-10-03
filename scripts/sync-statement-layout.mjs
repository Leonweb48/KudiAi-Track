// Copies the statement PDF layout to the edge functions, byte for byte (see the header of src/utils/statementPdfLayout.js).
// The monthly client statement email builds its PDF on the server with this copy; src/__tests__/clientStatements.test.js
// fails while the two differ.
import fs from "node:fs";
const SRC = new URL("../src/utils/statementPdfLayout.js", import.meta.url);
const DST = new URL("../supabase/functions/_shared/statementPdfLayout.js", import.meta.url);
fs.copyFileSync(SRC, DST);
console.log("statement layout copied to supabase/functions/_shared/statementPdfLayout.js");
