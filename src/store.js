import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

const useStore = create(
  persist(
    (set) => ({
      // 우리 회사(공급자)는 여러 개일 수 있다. 명세서를 만들 때 그중 하나를 고른다.
      suppliers: [{
        id: 'supplier-1',
        regNo: '222-22-22222',
        name: '웰포인트',
        president: '허덕룡',
        address: '인천광역시 ...',
        businessType: '제조',
        businessItem: '정밀 금형',
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
          name: '화경',
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

      saveTransaction: (transaction) => set((state) => {
        // 이미 목록에 있는 내역(id를 들고 온 경우)은 반드시 그 id로 찾는다.
        // (연도, 월, 거래처명)으로 찾으면 같은 달에 같은 거래처로 발행한 다른
        // 명세서를 덮어쓴다 — 기존 프로그램에서 가져온 내역에는 그런 조합이
        // 575건 있고 한 조합에 최대 13건까지 몰려 있다.
        const existingIndex = transaction.id
          ? state.transactions.findIndex(t => t.id === transaction.id)
          : state.transactions.findIndex(
              t => t.year === transaction.year && t.month === transaction.month && t.companyName === transaction.companyName
            );

        if (existingIndex >= 0) {
          // Update existing
          const newTransactions = [...state.transactions];
          newTransactions[existingIndex] = { ...newTransactions[existingIndex], ...transaction, id: newTransactions[existingIndex].id || Date.now().toString() };
          return { transactions: newTransactions };
        } else {
          // Add new
          return { transactions: [...state.transactions, { ...transaction, id: Date.now().toString() }] };
        }
      }),
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
      setExcelState: (data) => set((state) => ({ ...state, ...data })),
    }),
    {
      name: 'invoice-storage', // local storage key name
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
