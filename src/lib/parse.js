// Read an uploaded CSV or Excel file into { headers, rows }. Runs entirely in
// the browser; the file never leaves this computer.

import Papa from 'papaparse';
import { matrixToRows, detectColumns } from './columns.js';

const goodness = ({ headers, rows }) => {
  const m = detectColumns(headers);
  return (m.route && m.street ? 1000 : 0) + Object.values(m).filter(Boolean).length * 10 + Math.min(rows.length, 9);
};

export async function readRouteFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    const { data } = Papa.parse(await file.text(), { skipEmptyLines: false });
    return matrixToRows(data);
  }

  if (/\.(xlsx|xlsm|xlsb|xls|ods)$/.test(name)) {
    const XLSX = await import('xlsx'); // loaded only when needed
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    // Use the sheet that looks most like a route list.
    let best = null;
    for (const sheetName of wb.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
      const parsed = matrixToRows(matrix);
      if (!best || goodness(parsed) > goodness(best)) best = { ...parsed, sheetName };
    }
    if (best) return best;
  }

  throw new Error("We can't read this kind of file. In Excel, choose File → Save As → Excel Workbook (.xlsx) or CSV, then upload that.");
}
