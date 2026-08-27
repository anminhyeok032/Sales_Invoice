import React, { useState, useEffect, useRef } from 'react';
import useStore from '../store';
import { Plus, Trash2, Save, X, Link2, Unlink, RefreshCw } from 'lucide-react';
import {
  isFileSystemAccessSupported,
  pickExcelFile,
  loadCompanyHandle,
  clearCompanyHandle,
  ensurePermission,
  readCompaniesFromHandle,
  writeCompaniesToHandle,
} from '../lib/companyExcelSync';

function CompanyManager() {
  const {
    myCompany, setMyCompany, companies, addCompany, updateCompany, deleteCompany, setCompanies,
    companyExcelFileName, setCompanyExcelFileName, companiesDirty, setCompaniesDirty,
  } = useStore();
  const [myCompState, setMyCompState] = useState(myCompany);

  // --- Excel file sync (거래처 목록 <-> 업체목록.xls) ---
  const fileHandleRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState('checking'); // checking | unsupported | disconnected | needs-permission | connected
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    if (!isFileSystemAccessSupported()) {
      setSyncStatus('unsupported');
      return;
    }
    (async () => {
      const handle = await loadCompanyHandle();
      if (!handle) {
        setSyncStatus('disconnected');
        return;
      }
      fileHandleRef.current = handle;
      setCompanyExcelFileName(handle.name);
      const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
      if (granted) {
        setSyncStatus('connected');
        await loadFromFile(handle);
      } else {
        setSyncStatus('needs-permission');
      }
    })();
  }, []);

  const loadFromFile = async (handle) => {
    try {
      const parsed = await readCompaniesFromHandle(handle);
      setCompanies(parsed);
      setCompaniesDirty(false);
      setSyncError('');
    } catch (err) {
      setSyncError('엑셀 파일을 읽는 중 오류가 발생했습니다: ' + err.message);
    }
  };

  const handleConnectExcel = async () => {
    try {
      const handle = await pickExcelFile();
      fileHandleRef.current = handle;
      setCompanyExcelFileName(handle.name);
      setSyncStatus('connected');
      await loadFromFile(handle);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setSyncError('파일 연결에 실패했습니다: ' + err.message);
      }
    }
  };

  const handleReconnectPermission = async () => {
    const handle = fileHandleRef.current;
    if (!handle) return;
    const granted = await ensurePermission(handle, 'readwrite');
    if (granted) {
      setSyncStatus('connected');
      await loadFromFile(handle);
    }
  };

  const handleManualReload = async () => {
    if (!fileHandleRef.current) return;
    if (companiesDirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 엑셀 파일 내용으로 덮어쓰시겠습니까?')) {
      return;
    }
    await loadFromFile(fileHandleRef.current);
  };

  const handleSaveToExcel = async () => {
    if (!fileHandleRef.current) return;
    try {
      await writeCompaniesToHandle(fileHandleRef.current, companies);
      setCompaniesDirty(false);
      setSyncError('');
    } catch (err) {
      setSyncError('엑셀 파일에 저장하는 중 오류가 발생했습니다: ' + err.message);
    }
  };

  const handleDisconnectExcel = async () => {
    await clearCompanyHandle();
    fileHandleRef.current = null;
    setCompanyExcelFileName('');
    setSyncStatus('disconnected');
    setCompaniesDirty(false);
    setSyncError('');
  };

  // --- 우리 회사 정보 (공급자) ---
  const handleMyCompChange = (field, value) => {
    setMyCompState(prev => ({ ...prev, [field]: value }));
  };

  const handleStampUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      handleMyCompChange('stamp', event.target.result);
    };
    reader.readAsDataURL(file);
  };

  const saveMyComp = () => {
    setMyCompany(myCompState);
    alert('우리 회사 정보가 저장되었습니다.');
  };

  // --- 거래처 목록 (공급받는자) — local edits only mark the list dirty; saving to excel is a manual action ---
  const handleAddCompany = () => {
    addCompany({ name: '새 회사', regNo: '', president: '', address: '', businessType: '', businessItem: '', phone: '' });
    if (syncStatus === 'connected') setCompaniesDirty(true);
  };

  const handleUpdateCompany = (id, patch) => {
    updateCompany(id, patch);
    if (syncStatus === 'connected') setCompaniesDirty(true);
  };

  const handleDeleteCompany = (id) => {
    deleteCompany(id);
    if (syncStatus === 'connected') setCompaniesDirty(true);
  };

  return (
    <div>
      <div className="header">
        <h1>업체 관리</h1>
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>우리 회사 정보 (공급자)</span>
          <button className="btn btn-primary" onClick={saveMyComp}><Save size={16} /> 저장</button>
        </div>
        <div className="grid-3">
          <div className="input-group">
            <label className="input-label">등록번호</label>
            <input className="input-field" value={myCompState.regNo} onChange={e => handleMyCompChange('regNo', e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">상호</label>
            <input className="input-field" value={myCompState.name} onChange={e => handleMyCompChange('name', e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">대표자</label>
            <input className="input-field" value={myCompState.president} onChange={e => handleMyCompChange('president', e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">업태</label>
            <input className="input-field" value={myCompState.businessType} onChange={e => handleMyCompChange('businessType', e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">종목</label>
            <input className="input-field" value={myCompState.businessItem} onChange={e => handleMyCompChange('businessItem', e.target.value)} />
          </div>
          <div className="input-group" style={{ gridColumn: 'span 2' }}>
            <label className="input-label">주소</label>
            <input className="input-field" value={myCompState.address} onChange={e => handleMyCompChange('address', e.target.value)} />
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">도장(인) 이미지</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{
              width: '60px', height: '60px', border: '1px solid var(--border-color)', borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
              backgroundColor: '#f8fafc'
            }}>
              {myCompState.stamp ? (
                <img src={myCompState.stamp} alt="도장 미리보기" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>미등록</span>
              )}
            </div>
            <label className="btn" style={{ cursor: 'pointer', margin: 0 }}>
              이미지 업로드
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleStampUpload} />
            </label>
            {myCompState.stamp && (
              <button className="btn" style={{ color: 'red' }} onClick={() => handleMyCompChange('stamp', '')}>
                <X size={16} /> 삭제
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>거래처 목록 (공급받는자)</span>
          <button className="btn" onClick={handleAddCompany}><Plus size={16} /> 거래처 추가</button>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem',
          padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '6px', flexWrap: 'wrap'
        }}>
          {syncStatus === 'checking' && (
            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>엑셀 연동 상태 확인 중...</span>
          )}
          {syncStatus === 'unsupported' && (
            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
              이 브라우저는 엑셀 파일 자동 연동을 지원하지 않습니다 (Chrome 또는 Edge에서만 가능).
            </span>
          )}
          {syncStatus === 'disconnected' && (
            <>
              <span style={{ fontSize: '0.875rem', color: '#64748b' }}>업체목록.xls 파일과 연동되어 있지 않습니다.</span>
              <button className="btn" onClick={handleConnectExcel}><Link2 size={16} /> 엑셀 파일 연결</button>
            </>
          )}
          {syncStatus === 'needs-permission' && (
            <>
              <span style={{ fontSize: '0.875rem', color: '#b45309' }}>
                연결된 파일({companyExcelFileName})에 대한 접근 권한이 필요합니다.
              </span>
              <button className="btn" onClick={handleReconnectPermission}><Link2 size={16} /> 다시 연결</button>
            </>
          )}
          {syncStatus === 'connected' && (
            <>
              <span style={{ fontSize: '0.875rem', color: '#16a34a', fontWeight: 500 }}>
                연동됨: {companyExcelFileName}{companiesDirty ? ' (저장 안 된 변경사항 있음)' : ''}
              </span>
              <button className="btn" onClick={handleManualReload}><RefreshCw size={16} /> 엑셀에서 불러오기</button>
              <button className="btn btn-primary" onClick={handleSaveToExcel} disabled={!companiesDirty}><Save size={16} /> 수정사항 저장하기</button>
              <button className="btn" onClick={handleDisconnectExcel}><Unlink size={16} /> 연동 해제</button>
            </>
          )}
          {syncError && <span style={{ fontSize: '0.875rem', color: 'red', width: '100%' }}>{syncError}</span>}
        </div>

        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>상호(엑셀과 동일)</th>
                <th>등록번호</th>
                <th>대표자</th>
                <th>업태</th>
                <th>종목</th>
                <th>주소</th>
                <th>전화</th>
                <th style={{ width: '60px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {companies.map(comp => (
                <tr key={comp.id}>
                  <td><input className="input-field" value={comp.name} onChange={e => handleUpdateCompany(comp.id, { name: e.target.value })} /></td>
                  <td><input className="input-field" value={comp.regNo} onChange={e => handleUpdateCompany(comp.id, { regNo: e.target.value })} /></td>
                  <td><input className="input-field" value={comp.president} onChange={e => handleUpdateCompany(comp.id, { president: e.target.value })} /></td>
                  <td><input className="input-field" value={comp.businessType} onChange={e => handleUpdateCompany(comp.id, { businessType: e.target.value })} /></td>
                  <td><input className="input-field" value={comp.businessItem} onChange={e => handleUpdateCompany(comp.id, { businessItem: e.target.value })} /></td>
                  <td><input className="input-field" value={comp.address} onChange={e => handleUpdateCompany(comp.id, { address: e.target.value })} /></td>
                  <td><input className="input-field" value={comp.phone || ''} onChange={e => handleUpdateCompany(comp.id, { phone: e.target.value })} /></td>
                  <td>
                    <button className="btn" style={{ padding: '0.25rem', color: 'red' }} onClick={() => handleDeleteCompany(comp.id)}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#64748b' }}>
            * 거래처 상호를 엑셀 파일의 '업체' 이름과 동일하게 입력해두면 명세서 작성 시 자동으로 정보가 불려옵니다.
            {syncStatus === 'connected' && ' 위 목록을 수정한 뒤에는 "수정사항 저장하기" 버튼을 눌러야 연동된 엑셀 파일에 반영됩니다.'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default CompanyManager;
