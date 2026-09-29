import { useCallback, useState } from 'react';

const NONE = {};   // 필터 없음. 매번 새 객체를 만들지 않도록 하나만 쓴다.

// 품목표의 컬럼 필터 상태. 표가 아니라 부모 화면이 들고 있어야 한다 —
// 출력도 지금 보이는 줄(필터 결과)만 찍어야 해서 부모가 같은 필터를 알아야 하기 때문.
//
// scopeKey가 바뀌면(다른 거래처/다른 명세서를 고르면) 필터를 비운다. 앞 명세서에서 체크한
// 값이 다음 명세서에는 없어서 표가 텅 비는 일, 그리고 나중에 그 명세서로 돌아왔을 때
// 잊어버린 필터가 되살아나 일부만 출력되는 일을 막는다.
export function useItemFilters(scopeKey) {
  const [state, setState] = useState({ scopeKey, filters: NONE });

  const setFilters = useCallback((next) => {
    setState((prev) => {
      const current = prev.scopeKey === scopeKey ? prev.filters : NONE;
      return { scopeKey, filters: typeof next === 'function' ? next(current) : next };
    });
  }, [scopeKey]);

  // 렌더 중에 상태를 맞추는 방식(React가 권장하는 "props가 바뀔 때 상태 초기화" 패턴).
  // 이 렌더에서 곧바로 비워서 낡은 필터가 한 번이라도 화면/출력에 쓰이지 않게 한다.
  if (state.scopeKey !== scopeKey) {
    setState({ scopeKey, filters: NONE });
    return [NONE, setFilters];
  }
  return [state.filters, setFilters];
}
