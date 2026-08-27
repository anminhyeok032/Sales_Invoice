const xlsx = require('xlsx');
const fs = require('fs');

try {
  const workbook = xlsx.readFile('private-data/2026년도NC가공일지.xlsx');
  console.log('Sheet Names:', workbook.SheetNames);
  
  const firstSheet = workbook.Sheets['1월'];
  const data = xlsx.utils.sheet_to_json(firstSheet, { header: 1 });
  
  console.log('\n--- First 5 rows of the 1월 sheet ---');
  for (let i = 0; i < Math.min(5, data.length); i++) {
    console.log(`Row ${i + 1}:`, data[i]);
  }
} catch (e) {
  console.error('Error reading excel file:', e.message);
}
