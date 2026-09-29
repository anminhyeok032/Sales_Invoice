import useStore from '../store';

// 비고 칸에 무엇을 찍을지 고르는 체크박스. 새 명세서 작성/저장된 내역이 같은 설정을 쓴다.
function PrintOptions() {
  const printOptions = useStore((s) => s.printOptions);
  const setPrintOptions = useStore((s) => s.setPrintOptions);
  const { showNote = true, showDailySum = true } = printOptions || {};

  return (
    <div style={{
      display: 'flex', gap: '0.25rem 1rem', flexWrap: 'wrap', alignItems: 'center',
      fontSize: '0.8125rem', color: '#334155',
    }}>
      <span style={{ fontWeight: 600 }}>출력할 비고</span>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={showDailySum} onChange={(e) => setPrintOptions({ showDailySum: e.target.checked })} />
        일별 합계 (그날 마지막 줄에 만원 단위)
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={showNote} onChange={(e) => setPrintOptions({ showNote: e.target.checked })} />
        품목 비고 메모
      </label>
    </div>
  );
}

export default PrintOptions;
