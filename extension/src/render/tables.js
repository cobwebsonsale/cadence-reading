import { colorOf } from './styles.js';

const PT_TO_PX = 96 / 72;

export function buildTable(table, ctx, buildContent) {
  const tableEl = document.createElement('table');
  tableEl.className = 'dr-table';

  const columnProps = table.tableStyle?.tableColumnProperties || [];
  const columnWidths = columnProps.map((c) =>
    c?.width?.magnitude ? Math.round(c.width.magnitude * PT_TO_PX) : null
  );

  const tbody = document.createElement('tbody');
  for (const row of table.tableRows || []) {
    const tr = document.createElement('tr');
    const cells = row.tableCells || [];
    for (let columnIndex = 0; columnIndex < cells.length; columnIndex++) {
      const cell = cells[columnIndex];
      const td = document.createElement('td');
      td.className = 'dr-cell';

      applyCellStyle(td, cell.tableCellStyle);
      if (columnWidths[columnIndex]) td.style.width = `${columnWidths[columnIndex]}px`;

      const columnSpan = cell.tableCellStyle?.columnSpan;
      const rowSpan = cell.tableCellStyle?.rowSpan;
      if (columnSpan && columnSpan > 1) td.colSpan = columnSpan;
      if (rowSpan && rowSpan > 1) td.rowSpan = rowSpan;

      buildContent(cell.content || [], td, ctx);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tableEl.appendChild(tbody);

  // Explicit widths keep their column total (and scroll if wide); evenly-distributed fills the paper.
  const total = columnWidths.reduce((sum, w) => sum + (w || 0), 0);
  if (total && columnWidths.some((w) => w != null)) tableEl.style.width = `${total}px`;

  const wrap = document.createElement('div');
  wrap.className = 'dr-table-wrap';
  wrap.appendChild(tableEl);
  return wrap;
}

function applyCellStyle(td, style) {
  if (!style) return;
  const toPx = (dimension) =>
    dimension && typeof dimension.magnitude === 'number'
      ? `${Math.round(dimension.magnitude * PT_TO_PX)}px`
      : null;
  const top = toPx(style.paddingTop);
  const right = toPx(style.paddingRight);
  const bottom = toPx(style.paddingBottom);
  const left = toPx(style.paddingLeft);
  if (top || right || bottom || left) {
    td.style.padding = `${top || '0'} ${right || '0'} ${bottom || '0'} ${left || '0'}`;
  }

  applyBorder(td, 'borderTop', style.borderTop);
  applyBorder(td, 'borderRight', style.borderRight);
  applyBorder(td, 'borderBottom', style.borderBottom);
  applyBorder(td, 'borderLeft', style.borderLeft);
}

function applyBorder(td, property, border) {
  if (!border) return;
  const width = border.width?.magnitude ? Math.round(border.width.magnitude * PT_TO_PX) : 1;
  const color = colorOf(border.color) || 'currentColor';
  const lineStyle = border.dashStyle === 'DASH' ? 'dashed' : 'solid';
  td.style[property] = `${width}px ${lineStyle} ${color}`;
}

