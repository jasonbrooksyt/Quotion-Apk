/* file-saver.js — classic blob download only (no native share sheet, per request).

   Note: on some Android Chrome builds, pages opened via file:// can silently
   block programmatic downloads. If "Download PDF/Word" stops producing a
   file after this change, that's the likely cause — say so and a share-sheet
   fallback can be added back. */

const FileSaver = (function () {

  async function saveOrShare(blob, filename) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { method: 'download' };
    } catch (err) {
      return { method: 'failed', error: err };
    }
  }

  return { saveOrShare };
})();
