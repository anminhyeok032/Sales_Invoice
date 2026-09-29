import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { loadTransactions, saveTransactions } from './lib/transactionDb';

export const EMPTY_SUPPLIER = {
  regNo: '', name: '', president: '', address: '', businessType: '', businessItem: '', stamp: '',
};

// 선택자(useStore(selector))에서 쓰이므로 매번 새 객체를 만들면 안 된다.
const FALLBACK_SUPPLIER = Object.freeze({ id: '', ...EMPTY_SUPPLIER });

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
const EXCEL_SESSION_KEYS = ['excelRawData', 'excelGroupedData', 'excelOverrides'];
let warnedStorage = false;
const safeStorage = {
  getItem: (name) => localStorage.getItem(name),
  removeItem: (name) => localStorage.removeItem(name),
  setItem: (name, value) => {
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
      addCompany: (company) => set((state) => ({
        companies: [...state.companies, { ...company, id: Date.now().toString() }]
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
            const id = newTransactions[existingIndex].id || Date.now().toString();
            newTransactions[existingIndex] = { ...newTransactions[existingIndex], ...transaction, id };
            savedId = id;
            return { transactions: newTransactions };
          }
          // Add new
          savedId = Date.now().toString();
          return { transactions: [...state.transactions, { ...transaction, id: savedId }] };
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
      version: 1,
      migrate: (persisted, version) => {
        if (version < 1 && persisted && persisted.myCompany) {
          const { myCompany, ...rest } = persisted;
          return {
            ...rest,
            suppliers: [{ ...EMPTY_SUPPLIER, ...myCompany, id: 'supplier-1' }],
            defaultSupplierId: 'supplier-1',
          };
        }
        return persisted;
      },
      // 저장된 내역은 용량이 커서 localStorage에 넣지 않는다 (transactionDb.js).
      partialize: (state) => {
        const rest = { ...state };
        delete rest.transactions;
        delete rest.transactionsLoaded;
        return rest;
      },
    }
  )
);

let writeTimer = null;
let lastWritten = null;
let initPromise = null;

// 앱 시작 시 한 번 호출. IndexedDB에서 저장된 내역을 읽어오고, 이후 변경분을
// 계속 IndexedDB로 넘긴다. StrictMode에서 effect가 두 번 도는 등 여러 번
// 불려도 구독은 하나만 걸리도록 한다.
export function initTransactionPersistence() {
  if (!initPromise) initPromise = doInitTransactionPersistence();
  return initPromise;
}

async function doInitTransactionPersistence() {
  const stored = await loadTransactions();

  if (stored === null) {
    // 이 버전으로 올라온 뒤 첫 실행. 예전에는 내역이 localStorage에 있었고
    // persist가 방금 그걸 state로 복원해 놨으므로, 그대로 IndexedDB로 옮긴다.
    // (partialize 때문에 다음 저장부터 localStorage에서는 사라진다.)
    const existing = useStore.getState().transactions;
    if (existing.length) await saveTransactions(existing);
    lastWritten = existing;
    useStore.setState({ transactionsLoaded: true });
  } else {
    lastWritten = stored;
    useStore.setState({ transactions: stored, transactionsLoaded: true });
  }

  useStore.subscribe((state) => {
    if (state.transactions === lastWritten) return;
    lastWritten = state.transactions;
    // 항목 하나 고칠 때마다 3MB를 다시 쓰지 않도록 잠깐 모아서 쓴다.
    clearTimeout(writeTimer);
    const snapshot = state.transactions;
    writeTimer = setTimeout(() => {
      saveTransactions(snapshot).catch((err) => {
        console.error('저장된 내역을 IndexedDB에 쓰지 못했습니다:', err);
      });
    }, 400);
  });
}

export default useStore;
