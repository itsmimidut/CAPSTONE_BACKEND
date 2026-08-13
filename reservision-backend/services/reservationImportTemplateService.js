import ExcelJS from 'exceljs';
import db from '../config/db.js';

const HEADERS = [
  'Reservation Code', 'Guest Name', 'Email', 'Contact Number', 'Item Type', 'Room/Facility',
  'Check-in', 'Check-out', 'Adults', 'Children', 'Seniors', 'Infants', 'Total Amount',
  'Amount Paid', 'Payment Method', 'Payment Status', 'Booking Status', 'Notes',
];
const OPTION_COLUMNS = [
  ['Item Type', ['Room', 'Cottage', 'Event', 'Swimming']],
  ['Payment Method', ['Cash', 'Credit Card', 'Debit Card', 'Bank Transfer', 'GCash', 'PayMaya']],
  ['Payment Status', ['Unpaid', 'Partially Paid', 'Paid', 'Refunded']],
  ['Booking Status', ['Pending', 'Confirmed', 'Checked-In', 'Checked-Out', 'Cancelled']],
];
const LAST_IMPORT_ROW = 1000;

const listRange = (column, count) => `'Dropdown Lists'!$${column}$2:$${column}$${Math.max(2, count + 1)}`;

export async function generateReservationImportTemplate() {
  const [inventory] = await db.query(
    `SELECT DISTINCT TRIM(name) AS name
       FROM inventory_items
      WHERE status = 'Available' AND name IS NOT NULL AND TRIM(name) <> ''
      ORDER BY name ASC`,
  );
  const inventoryNames = inventory.map((item) => item.name);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Reservision';
  workbook.created = new Date();
  const reservations = workbook.addWorksheet('Reservations', { views: [{ state: 'frozen', ySplit: 1 }] });
  const lists = workbook.addWorksheet('Dropdown Lists');

  reservations.addRow(HEADERS);
  reservations.columns = HEADERS.map((header, index) => ({
    header,
    key: `column_${index + 1}`,
    width: index === 17 ? 34 : Math.max(14, header.length + 3),
  }));
  reservations.getRow(1).height = 24;
  reservations.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C3B5E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  reservations.autoFilter = { from: 'A1', to: 'R1' };

  const optionData = [...OPTION_COLUMNS, ['Room/Facility', inventoryNames]];
  optionData.forEach(([heading, values], columnIndex) => {
    const column = columnIndex + 1;
    lists.getCell(1, column).value = heading;
    values.forEach((value, rowIndex) => { lists.getCell(rowIndex + 2, column).value = value; });
    lists.getColumn(column).width = Math.max(18, heading.length + 2, ...values.map(value => String(value).length + 2));
  });
  lists.getRow(1).font = { bold: true };
  lists.state = 'hidden';

  const validations = [
    ['E', 'A', OPTION_COLUMNS[0][1].length, 'Item Type', 'ImportItemTypes'],
    ['F', 'E', inventoryNames.length, 'Room/Facility', 'ImportInventoryItems'],
    ['O', 'B', OPTION_COLUMNS[1][1].length, 'Payment Method', 'ImportPaymentMethods'],
    ['P', 'C', OPTION_COLUMNS[2][1].length, 'Payment Status', 'ImportPaymentStatuses'],
    ['Q', 'D', OPTION_COLUMNS[3][1].length, 'Booking Status', 'ImportBookingStatuses'],
  ];
  validations.forEach(([, source, count, , rangeName]) => {
    workbook.definedNames.add(listRange(source, count), rangeName);
  });

  for (let row = 2; row <= LAST_IMPORT_ROW; row += 1) {
    validations.forEach(([target, , , label, rangeName]) => {
      reservations.getCell(`${target}${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [rangeName],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: `Invalid ${label}`,
        error: `Select a ${label.toLowerCase()} from the dropdown list.`,
      };
    });
    reservations.getCell(`G${row}`).numFmt = 'yyyy-mm-dd';
    reservations.getCell(`G${row}`).dataValidation = {
      type: 'date', operator: 'between', allowBlank: false,
      formulae: [new Date('1900-01-01'), new Date('9999-12-31')],
      showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Invalid Check-in',
      error: 'Enter a valid date using YYYY-MM-DD.',
    };
    reservations.getCell(`H${row}`).numFmt = 'yyyy-mm-dd';
    reservations.getCell(`H${row}`).dataValidation = {
      type: 'custom', allowBlank: false, formulae: [`AND(ISNUMBER(H${row}),H${row}>G${row})`],
      showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Invalid Check-out',
      error: 'Check-out must be a valid date later than check-in.',
    };
    ['I', 'J', 'K', 'L'].forEach((column) => { reservations.getCell(`${column}${row}`).numFmt = '0'; });
    ['M', 'N'].forEach((column) => { reservations.getCell(`${column}${row}`).numFmt = '#,##0.00'; });
  }

  return workbook.xlsx.writeBuffer();
}
