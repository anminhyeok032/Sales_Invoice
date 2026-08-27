import React, { useState, useEffect } from 'react';
import NewTransaction from './components/NewTransaction';
import History from './components/History';
import CompanyManager from './components/CompanyManager';
import { FileSpreadsheet, History as HistoryIcon, Building2 } from 'lucide-react';
import useStore from './store';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState('new');

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
    setActiveTab(tab);
  };

  return (
    <div className="app-container">
      {/* Navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
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
      {activeTab === 'new' && <NewTransaction />}
      {activeTab === 'history' && <History />}
      {activeTab === 'companies' && <CompanyManager />}
    </div>
  );
}

export default App;
