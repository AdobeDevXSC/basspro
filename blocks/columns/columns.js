export default function decorate(block) {
  const rows = [...block.children];
  const contentRow = rows[0];
  const cols = [...contentRow.children];
  block.classList.add(`columns-${cols.length}-cols`);

  // check if the last row is a style metadata row
  const lastRow = rows[rows.length - 1];
  if (rows.length > 1) {
    const lastRowCells = [...lastRow.children];
    const isStyleRow = lastRowCells.some((cell) => {
      const text = cell.textContent.trim();
      return text && !cell.querySelector('picture');
    });

    if (isStyleRow) {
      lastRow.style.display = 'none';
      lastRowCells.forEach((cell, i) => {
        const style = cell.textContent.trim();
        if (style && contentRow.children[i]) {
          contentRow.children[i].classList.add(style);
        }
      });
    }
  }

  // setup image columns
  rows.forEach((row) => {
    [...row.children].forEach((col) => {
      const pic = col.querySelector('picture');
      if (pic) {
        const picWrapper = pic.closest('div');
        if (picWrapper && picWrapper.children.length === 1) {
          picWrapper.classList.add('columns-img-col');
        }
      }
    });
  });
}
