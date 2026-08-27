import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useStore = create(
  persist(
    (set) => ({
      myCompany: {
        regNo: '222-22-22222',
        name: '웰포인트',
        president: '허덕룡',
        address: '인천광역시 ...',
        businessType: '제조',
        businessItem: '정밀 금형',
        stamp: '',
      },
      setMyCompany: (company) => set({ myCompany: company }),

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
      transactions: [],
      saveTransaction: (transaction) => set((state) => {
        const existingIndex = state.transactions.findIndex(
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
    }
  )
);

export default useStore;
