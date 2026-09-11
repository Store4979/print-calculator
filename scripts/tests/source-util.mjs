// Shared source-scanning helpers for the test suite.
//
// CRLF is the whole reason this is a shared function. JS `.` does not match
// \r, so on a CRLF checkout `/\/\/.*$/` can never reach `$` and a line comment
// survives stripping. A scan that then looks for a pattern finds it inside the
// surviving comment and fails for a reason that has nothing to do with the
// code. Normalise line endings FIRST, always.
export const stripComments = (src) =>
  src.replace(/\r\n?/g, "\n")
     .replace(/\/\*[\s\S]*?\*\//g, "")
     .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
