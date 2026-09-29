// 저장된 거래명세서 내역은 IndexedDB에 둔다.
//
// 기존 프로그램(Tradetax.gdb)에서 넘어온 내역만 3MB가 넘는데, localStorage는
// UTF-16으로 계산해서 약 5.6MB를 잡아먹는다. 브라우저 한도(보통 5MB)를 그냥 넘긴다.
// 그래서 transactions만 zustand persist(localStorage)에서 빼내 여기에 저장한다.
// 나머지 상태(회사 정보, 거래처, 엑셀 세션)는 작아서 localStorage 그대로 둔다.
//
// 핸들 저장용 DB(fileHandleStore.js)와는 다른 DB를 쓴다. 같은 DB에 스토어를
// 추가하려면 버전을 올려야 하고, 그러면 이미 저장된 파일 핸들 쪽을 건드리게 된다.

const DB_NAME = '거래명세서-자동-관리-data';
const STORE_NAME = 'kv';
const KEY = 'transactions';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 한 번도 저장한 적이 없으면 null. 빈 배열([])과 구별해야 최초 실행인지 알 수 있다.
export async function loadTransactions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(KEY);
    req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTransactions(transactions) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    // 구조화 복제(structured clone)로 들어가므로 JSON 직렬화 비용이 없다.
    tx.objectStore(STORE_NAME).put(transactions, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
