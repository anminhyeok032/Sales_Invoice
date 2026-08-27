export function createEmptyItem() {
  return { date: '', name: '', spec: '', unit: 'EA', qty: 0, price: 0, supply: 0, tax: 0, note: '' };
}

export function applyItemChange(items, index, field, value) {
  const newItems = [...items];
  newItems[index] = { ...newItems[index], [field]: value };

  if (field === 'price' || field === 'qty') {
    const q = Number(newItems[index].qty) || 0;
    const p = Number(newItems[index].price) || 0;
    newItems[index].supply = q * p;
    newItems[index].tax = Math.floor(newItems[index].supply * 0.1);
  }
  return newItems;
}

export function reorderItems(items, fromIndex, toIndex) {
  const newItems = [...items];
  const [moved] = newItems.splice(fromIndex, 1);
  newItems.splice(toIndex, 0, moved);
  return newItems;
}
