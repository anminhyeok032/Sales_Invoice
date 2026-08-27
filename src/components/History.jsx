import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store';
import { useReactToPrint } from 'react-to-print';
import TransactionPrintTemplate from './TransactionPrintTemplate';
import { Printer, Trash2, Plus, Save, Link2, Unlink } from 'lucide-react';
import {
  isFileSystemAccessSupported,
  getConnectedHandle,
  connectBackupFile,
  disconnectBackupFile,
  writeTransactionsBackup,
} from '../lib/transactionExcelSync';
import { applyItemChange, createEmptyItem } from '../lib/transactionItems';
import { findReceiverInfo } from '../lib/companyLookup';
import TransactionItemsTable from './TransactionItemsTable';

function History() {
  const {
    transactions, myCompany, companies, deleteTransaction, saveTransaction,
    transactionExcelFileName, setTransactionExcelFileName,
  } = useStore();
  const [selectedTx, setSelectedTx] = useState(null);
  const printRef = useRef();

  // --- Local excel backup of the saved transaction history (write-only) ---
  const [backupStatus, setBackupStatus] = useState('checking'); // checking | unsupported | disconnected | connected
  const [backupError, setBackupError] = useState('');

  useEffect(() => {
    if (!isFileSystemAccessSupported()) {
      setBackupStatus('unsupported');
      return;
    }
    (async () => {
      const handle = await getConnectedHandle();
      if (handle) {
        setTransactionExcelFileName(handle.name);
        setBackupStatus('connected');
      } else {
        setBackupStatus('disconnected');
      }
    })();
  }, []);

  const handleConnectBackup = async () => {
    try {
      const handle = await connectBackupFile();
      setTransactionExcelFileName(handle.name);
      setBackupStatus('connected');
      await writeTransactionsBackup(useStore.getState().transactions);
      setBackupError('');
    } catch (err) {
      if (err.name !== 'AbortError') {
        setBackupError('백업 파일 연결에 실패했습니다: ' + err.message);
      }
    }
  };

  const handleDisconnectBackup = async () => {
    await disconnectBackupFile();
    setTransactionExcelFileName('');
    setBackupStatus('disconnected');
    setBackupError('');
  };

  const backupNow = async () => {
    if (backupStatus !== 'connected') return;
    try {
      await writeTransactionsBackup(useStore.getState().transactions);
      setBackupError('');
    } catch (err) {
      setBackupError('백업 저장 중 오류가 발생했습니다: ' + err.message);
    }
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: selectedTx ? `거래명세서_${selectedTx.companyName}_${selectedTx.year}년${selectedTx.month}월` : '명세서',
  });

  const getReceiverInfo = (companyName) => findReceiverInfo(companies, companyName);

  const setItems = (items) => {
    if (!selectedTx) return;
    setSelectedTx({ ...selectedTx, items });
  };

  const handleItemChange = (index, field, value) => {
    if (!selectedTx) return;
    setItems(applyItemChange(selectedTx.items, index, field, value));
  };

  const addItem = () => {
    if (!selectedTx) return;
    setItems([...selectedTx.items, createEmptyItem()]);
  };

  const deleteItem = (index) => {
    if (!selectedTx) return;
    const newItems = [...selectedTx.items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const handleSave = () => {
    if (!selectedTx) return;
    saveTransaction(selectedTx);
    backupNow();
    alert('수정된 내용이 안전하게 저장되었습니다!');
  };

  return (
    <div>
      <div className="header">
        <h1>저장된 내역 관리</h1>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem',
        padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px', flexWrap: 'wrap'
      }}>
        {backupStatus === 'checking' && (
          <span style={{ fontSize: '0.875rem', color: '#64748b' }}>엑셀 백업 상태 확인 중...</span>
        )}
        {backupStatus === 'unsupported' && (
          <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
            이 브라우저는 로컬 엑셀 백업을 지원하지 않습니다 (Chrome 또는 Edge에서만 가능).
          </span>
        )}
        {backupStatus === 'disconnected' && (
          <>
            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>저장된 내역이 로컬 엑셀 파일로 백업되고 있지 않습니다.</span>
            <button className="btn" onClick={handleConnectBackup}><Link2 size={16} /> 엑셀 백업 연결</button>
          </>
        )}
        {backupStatus === 'connected' && (
          <>
            <span style={{ fontSize: '0.875rem', color: '#16a34a', fontWeight: 500 }}>
              엑셀 백업됨: {transactionExcelFileName} (저장할 때마다 자동 갱신)
            </span>
            <button className="btn" onClick={handleDisconnectBackup}><Unlink size={16} /> 백업 해제</button>
          </>
        )}
        {backupError && <span style={{ fontSize: '0.875rem', color: 'red', width: '100%' }}>{backupError}</span>}
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
                          backupNow();
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

              <TransactionItemsTable
                items={selectedTx.items}
                onItemChange={handleItemChange}
                onReorder={setItems}
                onDeleteItem={deleteItem}
                dateColWidth="80px"
              />
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
