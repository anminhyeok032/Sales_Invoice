import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { loadTransactions, writeTransactionChanges, readTransactions } from './lib/transactionDb';

export const EMPTY_SUPPLIER = {
  regNo: '', name: '', president: '', address: '', businessType: '', businessItem: '', stamp: '',
  // 입금 계좌. 명세서 왼쪽 아래(테두리 밖)에 그대로 찍힌다. 예: '은행 : 000000-00-000000 예금주'
  account: '',
};

// 선택자(useStore(selector))에서 쓰이므로 매번 새 객체를 만들면 안 된다.
const FALLBACK_SUPPLIER = Object.freeze({ id: '', ...EMPTY_SUPPLIER });

// 새 명세서 id. 예전에는 Date.now() 그대로라 같은 1/1000초에 두 건을 저장하면 id가 겹쳤다 —
// 명세서를 한 건씩(id를 키로) 저장하므로 겹치면 한 건이 다른 건을 덮어 사라진다. 시각 뒤에 무작위 꼬리를 붙인다.
const newTransactionId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const newSupplierId = () => `supplier-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// 공급자(우리 회사)를 id로 찾는다. 지워졌거나 지정이 없으면 기본 공급자, 그것도
// 없으면 첫 번째. 출력 양식이 빈 객체에서 터지지 않도록 항상 무언가를 돌려준다.
export function resolveSupplier(state, id) {
  const { suppliers = [], defaultSupplierId } = state;
  return suppliers.find((s) => s.id === id)
    || suppliers.find((s) => s.id === defaultSupplierId)
    || suppliers[0]
    || FALLBACK_SUPPLIER;
}

// localStorage 쓰기가 실패(용량 초과 등)하면 예외가 상태를 바꾼 호출(공급자 저장 등) 밖으로 새어 나가고,
// 그 뒤의 저장도 계속 실패해서 "저장했는데 껐다 켜면 사라지는" 증상이 된다. 도장 사진과 읽어 둔 엑셀
// 원본이 용량을 크게 차지한다. 실패하면 다시 만들 수 있는 엑셀 세션(읽은 원본/결과)을 빼고 한 번 더
// 쓰고, 그래도 안 되면 조용히 넘기지 말고 알린다.
//
// 창(탭)이 여러 개일 때: zustand persist는 상태가 조금만 바뀌어도(저장 안 하는 값이어도) 이 창이 아는
// 설정 전체를 통째로 다시 쓴다. 그래서 가공일지를 불러오기 전에 열어 둔 다른 창이 무언가를 하면(다른 창의
// 명세서 저장을 받아 반영하는 것만으로도) 그 창의 옛 상태 — 가공일지 없음 — 로 덮어써서, 다음에 열면
// 가공일지를 다시 불러와야 했다. 두 가지로 막는다:
//   1) 이 창이 저장할 값을 실제로 바꾸지 않았으면(마지막으로 읽거나 쓴 값과 같으면) 쓰지 않는다.
//   2) 다른 창이 저장소를 바꾸면(storage 이벤트) 이 창도 그 값을 다시 읽어 맞춘다(아래 rehydrate).
const EXCEL_SESSION_KEYS = ['excelRawData', 'excelGroupedData', 'excelOverrides'];
let warnedStorage = false;
let lastKnownValue = null;   // 이 창이 마지막으로 저장소에서 읽었거나 쓴 값
const safeStorage = {
  getItem: (name) => {
    lastKnownValue = localStorage.getItem(name);
    return lastKnownValue;
  },
  removeItem: (name) => localStorage.removeItem(name),
  setItem: (name, value) => {
    if (value === lastKnownValue) return;   // 이 창에서는 바뀐 것이 없다 — 다른 창의 저장을 덮지 않는다
    lastKnownValue = value;
    try {
      localStorage.setItem(name, value);
      return;
    } catch (firstError) {
      try {
        const parsed = JSON.parse(value);
        EXCEL_SESSION_KEYS.forEach((k) => { delete parsed.state?.[k]; });
        localStorage.setItem(name, JSON.stringify(parsed));
        console.warn('저장 공간이 부족해 엑셀 작업 내용은 저장하지 않았습니다:', firstError);
        return;
      } catch (error) {
        console.error('설정을 저장하지 못했습니다:', error);
        if (!warnedStorage) {
          warnedStorage = true;
          window.alert('브라우저 저장 공간이 부족해 입력한 내용을 저장하지 못했습니다.\n도장 이미지처럼 큰 파일을 줄이거나 지운 뒤 다시 시도하세요.');
        }
      }
    }
  },
};

const useStore = create(
  persist(
    (set) => ({
      // 우리 회사(공급자)는 여러 개일 수 있다. 명세서를 만들 때 그중 하나를 고른다.
      // (기본값은 실제 회사 정보가 아닌 자리표시자 — main의 5e75a0f와 같은 값)
      suppliers: [{
        id: 'supplier-1',
        regNo: '111-11-11111',
        name: '임시 회사',
        president: '이름',
        address: '주소',
        businessType: '분야',
        businessItem: '세부 분야',
        stamp: '',
      }],
      defaultSupplierId: 'supplier-1',
      addSupplier: (supplier) => {
        const id = newSupplierId();
        set((state) => ({ suppliers: [...state.suppliers, { ...EMPTY_SUPPLIER, ...supplier, id }] }));
        return id;
      },
      updateSupplier: (id, patch) => set((state) => ({
        suppliers: state.suppliers.map((s) => (s.id === id ? { ...s, ...patch, id } : s)),
      })),
      // 마지막 하나는 지우지 않는다 — 공급자 없이는 명세서를 못 만든다.
      deleteSupplier: (id) => set((state) => {
        if (state.suppliers.length <= 1) return {};
        const suppliers = state.suppliers.filter((s) => s.id !== id);
        const defaultSupplierId = state.defaultSupplierId === id ? suppliers[0].id : state.defaultSupplierId;
        return { suppliers, defaultSupplierId };
      }),
      setDefaultSupplier: (id) => set({ defaultSupplierId: id }),

      // 출력 설정. 비고 칸에 무엇을 찍을지 — 인쇄 양식이 이 값을 읽는다(새 명세서 작성/저장된 내역 공통).
      //  showNote: 품목의 비고(엑셀 비고 칸 등에서 온 메모)
      //  showDailySum: 그날 마지막 줄에 붙는 일별 공급가액 합계(만원 단위, 예: 15)
      printOptions: { showNote: true, showDailySum: true },
      setPrintOptions: (patch) => set((state) => ({ printOptions: { ...state.printOptions, ...patch } })),

      // 여러 줄을 합칠 때 수량/가공시간을 정하는 방식: 'sum'(합산) | 'max'(큰 값) | 'min'(작은 값)
      // 기본은 둘 다 합산(v2부터).
      mergeOptions: { qty: 'sum', time: 'sum' },
      setMergeOptions: (patch) => set((state) => ({ mergeOptions: { ...state.mergeOptions, ...patch } })),

      // 가공일지 엑셀의 업체 이름 -> 거래처 id. 사용자가 직접 골라 준 것만 남긴다.
      // 엑셀 이름은 매달 같으므로('가나'), 한 번 골라 두면 다음 달에도 그대로 쓴다.
      // ''는 "거래처 목록에 없는 회사로 처리"를 직접 고른 것.
      receiverAliases: {},
      setReceiverAlias: (excelName, companyId) => set((state) => ({
        receiverAliases: { ...state.receiverAliases, [excelName]: companyId },
      })),
      clearReceiverAlias: (excelName) => set((state) => {
        const next = { ...state.receiverAliases };
        delete next[excelName];
        return { receiverAliases: next };
      }),

      companies: [
        {
          id: '1',
          name: '임시',
          regNo: '',
          president: '',
          address: '',
          businessType: '',
          businessItem: '',
          phone: '',
        }
      ],
      // 새 거래처는 목록 맨 위에 넣는다(방금 추가한 것을 바로 찾아 고칠 수 있게). createdAt은 등록일 정렬용.
      addCompany: (company) => set((state) => ({
        companies: [{ ...company, id: Date.now().toString(), createdAt: Date.now() }, ...state.companies]
      })),
      updateCompany: (id, updatedCompany) => set((state) => ({
        companies: state.companies.map(c => c.id === id ? { ...c, ...updatedCompany } : c)
      })),
      deleteCompany: (id) => set((state) => ({
        companies: state.companies.filter(c => c.id !== id)
      })),
      setCompanies: (companies) => set({ companies }),

      // Company excel file sync (File System Access API handle info; the handle itself lives in IndexedDB)
      companyExcelFileName: '',
      setCompanyExcelFileName: (name) => set({ companyExcelFileName: name }),
      companiesDirty: false,
      setCompaniesDirty: (dirty) => set({ companiesDirty: dirty }),

      // transactions structure:
      // [{ id: string, year: number, month: number, companyName: string, date: string, items: array }]
      // Persisted to IndexedDB, not localStorage - see lib/transactionDb.js and
      // initTransactionPersistence() below. `transactions`/`transactionsLoaded`
      // are excluded from the localStorage blob by partialize.
      transactions: [],
      transactionsLoaded: false,
      // 가장 최근에 saveTransaction으로 저장한 명세서({ id, seq }). 저장된 내역 화면이 탭을 옮겨도 계속
      // 살아 있어서, 다른 화면에서 저장한 것이 그쪽 필터에 가려지거나 옛 사본으로 남지 않게 알려 주는 용도.
      lastSaved: null,
      setTransactions: (transactions) => set({ transactions }),

      // 저장한 명세서의 id를 돌려준다(저장 뒤에 그 명세서를 바로 열어 보여줄 때 쓴다).
      saveTransaction: (transaction) => {
        let savedId = '';
        set((state) => {
          // 이미 목록에 있는 내역(id를 들고 온 경우)은 반드시 그 id로 찾는다.
          // (연도, 월, 거래처명)만으로 찾으면 같은 달에 같은 거래처로 발행한 다른
          // 명세서를 덮어쓴다 — 기존 프로그램에서 가져온 내역에는 그런 조합이
          // 575건 있고 한 조합에 최대 13건까지 몰려 있다.
          //
          // id가 없는 새 저장은 (연도, 월, 거래처명, viewKey)가 같은 것을 갱신한다.
          // viewKey는 필터를 건 채로 저장했을 때의 필터 조건이다. 저장은 "지금 출력되는 상태"만
          // 저장하므로, 필터 조건이 다르면 같은 달·같은 거래처라도 별개 명세서다. 필터 없이 저장한
          // 전체 명세서는 viewKey가 ''라서 예전처럼 한 달에 하나로 갱신된다.
          // 기존 프로그램에서 가져온 내역('gdb-')은 여기서 자동으로 짝지어 덮어쓰지 않는다.
          const viewKey = transaction.viewKey || '';
          const existingIndex = transaction.id
            ? state.transactions.findIndex(t => t.id === transaction.id)
            : state.transactions.findIndex(
                t => !String(t.id).startsWith('gdb-')
                  && t.year === transaction.year && t.month === transaction.month
                  && t.companyName === transaction.companyName
                  && (t.viewKey || '') === viewKey
              );

          if (existingIndex >= 0) {
            // Update existing
            const newTransactions = [...state.transactions];
            const id = newTransactions[existingIndex].id || newTransactionId();
            newTransactions[existingIndex] = { ...newTransactions[existingIndex], ...transaction, id };
            savedId = id;
            return { transactions: newTransactions, lastSaved: { id, seq: (state.lastSaved?.seq || 0) + 1 } };
          }
          // Add new
          savedId = newTransactionId();
          return {
            transactions: [...state.transactions, { ...transaction, id: savedId }],
            lastSaved: { id: savedId, seq: (state.lastSaved?.seq || 0) + 1 },
          };
        });
        return savedId;
      },
      deleteTransaction: (id) => set((state) => ({
        transactions: state.transactions.filter(t => t.id !== id)
      })),

      // 기존 프로그램에서 가져온 내역을 합친다. 같은 id는 덮어쓰고 나머지는 그대로 둔다.
      importTransactions: (incoming) => set((state) => {
        const byId = new Map(state.transactions.map(t => [t.id, t]));
        incoming.forEach((t) => byId.set(t.id, t));
        return { transactions: [...byId.values()] };
      }),

      // Local excel backup of the saved transaction history (write-only, File System Access API handle lives in IndexedDB)
      transactionExcelFileName: '',
      setTransactionExcelFileName: (name) => set({ transactionExcelFileName: name }),

      // Excel Session State (persisted across navigation and reload)
      excelRawData: {}, 
      excelSheetNames: [],
      excelSelectedSheet: '',
      excelGroupedData: {},
      excelSelectedCompany: '',
      // excelGroupedData를 어떤 버전의 읽기 방식으로 만들었는지. 0 = 기록 없음(예전 방식).
      // 읽는 방식이 바뀌면(NewTransaction의 NC_PARSER_VERSION) 옛 방식으로 읽어 둔 결과를 알아본다 —
      // 결과가 브라우저에 저장돼 있어서, 코드를 고쳐도 파일을 다시 읽기 전에는 옛 결과가 그대로 보인다.
      excelParserVersion: 0,
      setExcelState: (data) => set((state) => ({ ...state, ...data })),
    }),
    {
      name: 'invoice-storage', // local storage key name
      storage: createJSONStorage(() => safeStorage),
      // v1: 공급자가 myCompany 하나에서 suppliers 목록으로 바뀌었다.
      // v2: 새로 합칠 때의 기본 방식을 수량·가공시간 모두 합산으로 통일(예전 기본값 '큰 값'으로 저장된 설정도 바꾼다).
      version: 2,
      migrate: (persisted, version) => {
        let next = persisted;
        if (version < 1 && next && next.myCompany) {
          const { myCompany, ...rest } = next;
          next = {
            ...rest,
            suppliers: [{ ...EMPTY_SUPPLIER, ...myCompany, id: 'supplier-1' }],
            defaultSupplierId: 'supplier-1',
          };
        }
        if (version < 2 && next) next = { ...next, mergeOptions: { qty: 'sum', time: 'sum' } };
        return next;
      },
      // 저장된 내역은 용량이 커서 localStorage에 넣지 않는다 (transactionDb.js).
      partialize: (state) => {
        const rest = { ...state };
        delete rest.transactions;
        delete rest.transactionsLoaded;
        delete rest.lastSaved;
        return rest;
      },
    }
  )
);

// --- 저장된 내역 <-> IndexedDB ---
// 명세서 한 건씩 저장한다(transactionDb.js 참고). 상태의 목록이 바뀌면 직전에 저장한 것과 비교해서
// 바뀐 명세서(객체가 달라진 것)만 쓰고, 없어진 명세서만 지운다. 상태는 항상 새 객체로 바꾸므로
// (불변 갱신) 객체가 같으면 내용도 같다.
//
// 창(탭)을 여러 개 열어 두어도 서로의 저장을 지우지 않도록, 저장이 끝나면 BroadcastChannel로 다른
// 창에 "이 명세서들이 바뀌었다/지워졌다"를 알리고, 알림을 받은 창은 저장소에서 그 명세서만 다시 읽어
// 자기 목록에 반영한다. 같은 명세서를 두 창에서 동시에 고치면 나중에 저장한 쪽이 남는다.
let persistedById = new Map();   // id -> 마지막으로 저장소와 맞춘 명세서 객체
let lastSeenList = null;         // 마지막으로 처리한 상태의 목록(같으면 건너뜀)
let writeChain = Promise.resolve();
let writeErrorShown = false;
let initPromise = null;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('거래명세서-저장내역') : null;

const keyOf = (t) => String(t.id);

function persistChanges(list) {
  const puts = [];
  const seen = new Set();
  list.forEach((t) => {
    const k = keyOf(t);
    seen.add(k);
    if (persistedById.get(k) !== t) puts.push(t);
  });
  const deleteIds = [...persistedById.keys()].filter((k) => !seen.has(k));
  if (puts.length === 0 && deleteIds.length === 0) return;

  persistedById = new Map(list.map((t) => [keyOf(t), t]));
  // 순서대로 쓴다(앞의 쓰기가 끝난 뒤 다음 쓰기). 한 번 실패해도 다음 쓰기는 계속한다.
  writeChain = writeChain
    .then(() => writeTransactionChanges(puts, deleteIds))
    .then(() => {
      channel?.postMessage({ changed: puts.map(keyOf), deleted: deleteIds });
    })
    .catch((err) => {
      console.error('저장된 내역을 IndexedDB에 쓰지 못했습니다:', err);
      if (!writeErrorShown) {
        writeErrorShown = true;
        window.alert('저장된 내역을 브라우저 저장소에 쓰지 못했습니다. 창을 닫기 전에 JSON 백업을 내려받아 두세요.\n(' + err.message + ')');
      }
    });
}

// 다른 창이 저장한 것을 이 창의 목록에 반영한다. 반영 결과를 "저장소와 같은 상태"로 기록해 두어
// 이 창이 그것을 다시 쓰지 않게 한다.
async function applyRemoteChanges({ changed = [], deleted = [] }) {
  const fresh = await readTransactions(changed);
  const freshById = new Map(fresh.map((t) => [keyOf(t), t]));
  const gone = new Set([...deleted, ...changed.filter((k) => !freshById.has(k))]);
  const current = useStore.getState().transactions;
  const next = current
    .filter((t) => !gone.has(keyOf(t)))
    .map((t) => freshById.get(keyOf(t)) || t);
  const known = new Set(next.map(keyOf));
  fresh.forEach((t) => { if (!known.has(keyOf(t))) next.push(t); });

  gone.forEach((k) => persistedById.delete(k));
  freshById.forEach((t, k) => persistedById.set(k, t));
  lastSeenList = next;
  useStore.setState({ transactions: next });
}

// 앱 시작 시 한 번 호출. IndexedDB에서 저장된 내역을 읽어오고, 이후 변경분을
// 계속 IndexedDB로 넘긴다. StrictMode에서 effect가 두 번 도는 등 여러 번
// 불려도 구독은 하나만 걸리도록 한다.
export function initTransactionPersistence() {
  if (!initPromise) initPromise = doInitTransactionPersistence();
  return initPromise;
}

async function doInitTransactionPersistence() {
  const stored = await loadTransactions();
  // 저장소를 읽는 동안(앱을 막 연 순간) 이미 저장한 것이 있으면 버리지 않고 합친다.
  const pending = useStore.getState().transactions;

  if (stored === null) {
    // 이 버전으로 올라온 뒤 첫 실행. 예전에는 내역이 localStorage에 있었고
    // persist가 방금 그걸 state로 복원해 놨으므로, 그대로 IndexedDB로 옮긴다.
    // (partialize 때문에 다음 저장부터 localStorage에서는 사라진다.)
    persistedById = new Map();
    persistChanges(pending);
    lastSeenList = pending;
    useStore.setState({ transactionsLoaded: true });
  } else {
    persistedById = new Map(stored.map((t) => [keyOf(t), t]));
    const pendingIds = new Set(pending.map(keyOf));
    const merged = [...stored.filter((t) => !pendingIds.has(keyOf(t))), ...pending];
    lastSeenList = merged;
    useStore.setState({ transactions: merged, transactionsLoaded: true });
    persistChanges(merged);   // pending이 있었으면 그것만 쓴다
  }

  useStore.subscribe((state) => {
    if (state.transactions === lastSeenList) return;
    lastSeenList = state.transactions;
    persistChanges(state.transactions);
  });

  if (channel) {
    channel.onmessage = (event) => {
      applyRemoteChanges(event.data || {}).catch((err) => console.error('다른 창의 저장을 반영하지 못했습니다:', err));
    };
  }
}

// 다른 창이 설정(가공일지 작업, 거래처, 공급자 등)을 바꾸면 이 창도 다시 읽어 같은 상태로 맞춘다.
// (key가 null이면 다른 창이 저장소를 통째로 비운 것)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key === 'invoice-storage' || event.key === null) useStore.persist.rehydrate();
  });
}

export default useStore;
