import React, { useState, useEffect } from 'react';
import NewTransaction from './components/NewTransaction';
import History from './components/History';
import CompanyManager from './components/CompanyManager';
import { FileSpreadsheet, History as HistoryIcon, Building2 } from 'lucide-react';
import useStore, { initTransactionPersistence } from './store';

function App() {
  const [activeTab, setActiveTab] = useState('new');
  // 한 번 열어 본 탭은 계속 살려 두고 숨기기만 한다. 탭을 옮길 때마다 화면을 없애면 그 화면이 들고 있던
  // 필터, 정렬, 고른 명세서, 수정 중인 줄이 모두 사라진다. 처음 열 때 만들어 이후에는 그대로 둔다.
  const [visited, setVisited] = useState({ new: true });

  // 저장된 내역은 localStorage가 아니라 IndexedDB에 있다. 앱이 뜨면 한 번 읽어온다.
  useEffect(() => {
    initTransactionPersistence().catch((err) => {
      console.error('저장된 내역을 불러오지 못했습니다:', err);
    });
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (useStore.getState().companiesDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const switchTab = (tab) => {
    if (activeTab === 'companies' && tab !== 'companies' && useStore.getState().companiesDirty) {
      const confirmed = window.confirm('거래처 목록에 저장하지 않은 변경사항이 있습니다. 저장하지 않고 이동하시겠습니까?');
      if (!confirmed) return;
    }
    setVisited((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
    setActiveTab(tab);
  };

  return (
    <div className="app-container">
      {/* Navigation */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
        <button
          className={`btn ${activeTab === 'new' ? 'btn-primary' : ''}`}
          onClick={() => switchTab('new')}
        >
          <FileSpreadsheet size={18} /> 새 명세서 작성 (엑셀)
        </button>
        <button
          className={`btn ${activeTab === 'history' ? 'btn-primary' : ''}`}
          onClick={() => switchTab('history')}
        >
          <HistoryIcon size={18} /> 저장된 내역 조회
        </button>
        <button
          className={`btn ${activeTab === 'companies' ? 'btn-primary' : ''}`}
          onClick={() => switchTab('companies')}
        >
          <Building2 size={18} /> 거래처 정보 관리
        </button>
      </div>

      {/* Main Content Area */}
      {visited.new && <div hidden={activeTab !== 'new'}><NewTransaction /></div>}
      {visited.history && <div hidden={activeTab !== 'history'}><History /></div>}
      {visited.companies && <div hidden={activeTab !== 'companies'}><CompanyManager /></div>}
    </div>
  );
}

export default App;
