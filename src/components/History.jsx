import React, { useState, useRef } from 'react';
import useStore from '../store';
import { useReactToPrint } from 'react-to-print';
import TransactionPrintTemplate from './TransactionPrintTemplate';
import { Printer, Trash2, Plus, Save, GripVertical } from 'lucide-react';

function History() {
  const { transactions, myCompany, companies, deleteTransaction, saveTransaction } = useStore();
  const [selectedTx, setSelectedTx] = useState(null);
  const printRef = useRef();

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: selectedTx ? `거래명세서_${selectedTx.companyName}_${selectedTx.year}년${selectedTx.month}월` : '명세서',
  });

  const getReceiverInfo = (companyName) => {
    return companies.find(c => c.name === companyName) || {
      regNo: '', name: companyName, president: '', address: '', businessType: '', businessItem: ''
    };
  };

  // Editing logic
  const handleItemChange = (index, field, value) => {
    if (!selectedTx) return;
    const newItems = [...selectedTx.items];
    newItems[index] = { ...newItems[index], [field]: value };

    if (field === 'price' || field === 'qty') {
      const q = Number(newItems[index].qty) || 0;
      const p = Number(newItems[index].price) || 0;
      newItems[index].supply = q * p;
      newItems[index].tax = Math.floor(newItems[index].supply * 0.1);
    }
    setSelectedTx({ ...selectedTx, items: newItems });
  };

  const addItem = () => {
    if (!selectedTx) return;
    const newItems = [...selectedTx.items, { date: '', name: '', spec: '', unit: 'EA', qty: 0, price: 0, supply: 0, tax: 0, note: '' }];
    setSelectedTx({ ...selectedTx, items: newItems });
  };

  const deleteItem = (index) => {
    if (!selectedTx) return;
    const newItems = [...selectedTx.items];
    newItems.splice(index, 1);
    setSelectedTx({ ...selectedTx, items: newItems });
  };

  const handleSave = () => {
    if (!selectedTx) return;
    saveTransaction(selectedTx);
    alert('수정된 내용이 안전하게 저장되었습니다!');
  };

  // Drag logic
  const [draggedItemIndex, setDraggedItemIndex] = useState(null);
  const [activeDragHandleIndex, setActiveDragHandleIndex] = useState(null);

  const handleDragStart = (e, index) => {
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (!selectedTx || draggedItemIndex === null || draggedItemIndex === targetIndex) return;
    
    const newItems = [...selectedTx.items];
    const [draggedItem] = newItems.splice(draggedItemIndex, 1);
    newItems.splice(targetIndex, 0, draggedItem);
    
    setSelectedTx({ ...selectedTx, items: newItems });
    setDraggedItemIndex(null);
    setActiveDragHandleIndex(null);
  };

  return (
    <div>
      <div className="header">
        <h1>저장된 내역 관리</h1>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        {/* Left: List of saved transactions */}
        <div className="card" style={{ minWidth: '350px', flexShrink: 0 }}>
          <div className="card-title">저장된 거래명세서 목록</div>
          {transactions.length === 0 ? (
            <p style={{ color: 'gray' }}>저장된 내역이 없습니다.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>연도/월</th>
                  <th>거래처명</th>
                  <th>작성일자</th>
                  <th>삭제</th>
                </tr>
              </thead>
              <tbody>
                {[...transactions]
                  .sort((a, b) => b.year - a.year || b.month - a.month || a.companyName.localeCompare(b.companyName))
                  .map(tx => (
                    <tr key={tx.id} style={{ cursor: 'pointer', backgroundColor: selectedTx?.id === tx.id ? '#e0f2fe' : '' }}>
                      <td onClick={() => setSelectedTx(tx)}>{tx.year}년 {tx.month}월</td>
                      <td onClick={() => setSelectedTx(tx)}><strong>{tx.companyName}</strong></td>
                      <td onClick={() => setSelectedTx(tx)}>{tx.date}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn" style={{ padding: '0.25rem', color: 'red' }} onClick={() => {
                          deleteTransaction(tx.id);
                          if (selectedTx?.id === tx.id) setSelectedTx(null);
                        }}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Right: Editable Table */}
        <div className="card" style={{ flexGrow: 1, overflowX: 'auto' }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{selectedTx ? `${selectedTx.companyName} 내역 수정` : '상세보기'}</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" onClick={addItem} disabled={!selectedTx}><Plus size={16} /> 줄 추가</button>
              <button className="btn" onClick={handleSave} disabled={!selectedTx}><Save size={16} /> 변경사항 저장</button>
              <button className="btn btn-primary" onClick={handlePrint} disabled={!selectedTx}>
                <Printer size={16} /> 출력/PDF
              </button>
            </div>
          </div>

          {selectedTx ? (
            <>
              <div className="input-group" style={{ width: '150px', marginBottom: '1rem' }}>
                <label className="input-label">출력용 작성일자</label>
                <input 
                  className="input-field" 
                  value={selectedTx.date} 
                  onChange={e => setSelectedTx({ ...selectedTx, date: e.target.value })} 
                />
              </div>

              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{width: '40px'}}>이동</th>
                      <th style={{width: '80px'}}>날짜</th>
                      <th>품목 (조합됨)</th>
                      <th>규격 (비고)</th>
                      <th style={{width: '70px'}}>단위</th>
                      <th style={{width: '80px'}}>수량</th>
                      <th style={{width: '120px'}}>단가 (입력)</th>
                      <th style={{width: '120px'}}>공급가액</th>
                      <th style={{width: '50px'}}>삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTx.items.map((item, index) => (
                      <tr 
                        key={index}
                        draggable={activeDragHandleIndex === index}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, index)}
                        style={{ 
                          opacity: draggedItemIndex === index ? 0.5 : 1,
                          transition: 'background-color 0.2s',
                          borderBottom: draggedItemIndex !== null && draggedItemIndex !== index ? '2px solid transparent' : '1px solid var(--border-color)',
                        }}
                        onDragEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                        onDragLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <td 
                          style={{ textAlign: 'center', color: '#94a3b8', cursor: 'grab' }}
                          onMouseEnter={() => setActiveDragHandleIndex(index)}
                          onMouseLeave={() => setActiveDragHandleIndex(null)}
                        >
                          <GripVertical size={18} style={{ margin: '0 auto' }} />
                        </td>
                        <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.date} onChange={e => handleItemChange(index, 'date', e.target.value)} /></td>
                        <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.name} onChange={e => handleItemChange(index, 'name', e.target.value)} /></td>
                        <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.spec} onChange={e => handleItemChange(index, 'spec', e.target.value)} /></td>
                        <td><input className="input-field" style={{ padding: '0.25rem' }} value={item.unit} onChange={e => handleItemChange(index, 'unit', e.target.value)} /></td>
                        <td><input className="input-field" style={{ padding: '0.25rem' }} type="number" value={item.qty} onChange={e => handleItemChange(index, 'qty', e.target.value)} /></td>
                        <td>
                          <input 
                            className="input-field" 
                            style={{ padding: '0.25rem', borderColor: '#3b82f6', textAlign: 'right' }} 
                            type="text" 
                            placeholder="단가" 
                            value={item.price ? Number(item.price).toLocaleString() : ''} 
                            onChange={e => {
                              const raw = e.target.value.replace(/[^0-9]/g, '');
                              handleItemChange(index, 'price', raw ? Number(raw) : 0);
                            }} 
                          />
                        </td>
                        <td style={{ textAlign: 'right', paddingRight: '1rem', fontWeight: '500' }}>{Number(item.supply).toLocaleString()}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn" style={{ padding: '0.25rem', color: 'red', border: 'none' }} onClick={() => deleteItem(index)}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>
              왼쪽 목록에서 내역을 선택해주세요.
            </div>
          )}
        </div>
      </div>

      {/* Hidden print template */}
      {selectedTx && (
        <div style={{ position: 'fixed', top: 0, left: '-10000px', opacity: 0, pointerEvents: 'none' }}>
          <TransactionPrintTemplate
            ref={printRef}
            data={selectedTx.items}
            supplier={myCompany}
            receiver={getReceiverInfo(selectedTx.companyName)}
            date={selectedTx.date}
          />
        </div>
      )}
    </div>
  );
}

export default History;
