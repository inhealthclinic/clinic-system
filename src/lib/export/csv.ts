/**
 * Экспорт произвольного массива объектов в CSV и скачивание в браузере.
 *
 * Почему CSV, а не XLSX:
 *   • для налоговой/аудита достаточно CSV — Excel откроет его напрямую;
 *   • не тянем 300KB xlsx-либы ради одной кнопки;
 *   • BOM \uFEFF в начале — чтобы Excel понял UTF-8 и не ломал кириллицу.
 *
 * Разделитель — точка с запятой: в ru-locale Excel по умолчанию ждёт
 * именно ';' и разбивает строку с ',' в одну колонку.
 */

export interface Column<T> {
  key: string            // заголовок столбца (человекочитаемый)
  value: (row: T) => string | number | null | undefined
}

function escape(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  // Экранируем: "..." и удваиваем внутренние кавычки, если есть ; или " или \n
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const header = columns.map(c => escape(c.key)).join(';')
  const body = rows.map(row =>
    columns.map(c => escape(c.value(row))).join(';')
  ).join('\r\n')
  return '\uFEFF' + header + '\r\n' + body
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Сокращение: собрать CSV и сразу скачать. */
export function exportCsv<T>(filename: string, rows: T[], columns: Column<T>[]): void {
  downloadCsv(filename, toCsv(rows, columns))
}

/** Текущая дата в YYYY-MM-DD — для суффикса имени файла. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
