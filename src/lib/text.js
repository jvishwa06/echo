/** Transcript clean-up. */

/** Spaces between CJK characters that the model's transcript sometimes carries. */
export function cleanCJKSpaces(text) {
  const cjk = /[　-〿぀-ゟ゠-ヿ一-龯＀-￯]/;
  return text.replace(/(\S)\s+(?=(\S))/g, (match, a, b) =>
    cjk.test(a) && cjk.test(b) ? a : match
  );
}
