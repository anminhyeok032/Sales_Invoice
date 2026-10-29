// 저장된 거래명세서 내역은 IndexedDB에 둔다.
//
// 기존 프로그램(Tradetax.gdb)에서 넘어온 내역만 3MB가 넘는데, localStorage는
// UTF-16으로 계산해서 약 5.6MB를 잡아먹는다. 브라우저 한도(보통 5MB)를 그냥 넘긴다.
// 그래서 transactions만 zustand persist(localStorage)에서 빼내 여기에 저장한다.
// 나머지 상태(회사 정보, 거래처, 엑셀 세션)는 작아서 localStorage 그대로 둔다.
//
// 핸들 저장용 DB(fileHandleStore.js)와는 다른 DB를 쓴다. 같은 DB에 스토어를
// 추가하려면 버전을 올려야 하고, 그러면 이미 저장된 파일 핸들 쪽을 건드리게 된다.
//
// v2: 명세서를 한 건씩(키 = 명세서 id) 'tx' 스토어에 둔다. v1은 'kv'의 'transactions' 키 하나에
// 목록 전체를 통째로 넣었는데, 창을 두 개 열어 두면 나중에 저장한 창의 목록이 다른 창에서 저장한
// 명세서를 지워 버렸다(각 창이 자기가 알던 목록 전체를 덮어씀). 이제는 바뀐 명세서만 쓰고 지운
// 명세서만 지우므로 다른 창의 저장을 건드리지 않는다. v1의 목록은 업그레이드할 때 'tx'로 옮기고,
// 'kv'의 옛 목록은 손대지 않고 남겨 둔다(옮기기 전 상태의 사본).

const DB_NAME = '거래명세서-자동-관리-data';
const DB_VERSION = 2;
const KV_STORE = 'kv';
const TX_STORE = 'tx';
const LEGACY_KEY = 'transactions';
// 'tx' 스토어를 한 번이라도 준비했는지. 없으면 최초 실행(아직 저장한 적 없음).
const READY_KEY = 'txStoreReady';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const upgradeTx = req.transaction;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(TX_STORE)) db.createObjectStore(TX_STORE);
      // v1 -> v2: 통째로 들어 있던 목록을 한 건씩 옮긴다(같은 업그레이드 트랜잭션 안이라 중간에 끊기지 않는다).
      if (event.oldVersion === 1) {
        const kv = upgradeTx.objectStore(KV_STORE);
        const getReq = kv.get(LEGACY_KEY);
        getReq.onsuccess = () => {
          const legacy = getReq.result;
          if (!Array.isArray(legacy)) return;
          const store = upgradeTx.objectStore(TX_STORE);
          legacy.forEach((t) => { if (t && t.id != null) store.put(t, String(t.id)); });
          kv.put(true, READY_KEY);
        };
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 다른 창이 더 새 버전으로 열려고 하면 이 연결을 닫아 막지 않게 한다.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn('다른 창이 예전 버전으로 열려 있어 저장소 업그레이드를 기다리는 중입니다.');
  });
  return dbPromise;
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

// 저장된 명세서 전부. 한 번도 준비한 적이 없으면(최초 실행) null — 빈 배열([])과 구별해야
// localStorage에 남아 있던 아주 옛 내역을 옮길지 알 수 있다.
export async function loadTransactions() {
  const db = await openDb();
  const tx = db.transaction([KV_STORE, TX_STORE], 'readonly');
  const readyReq = tx.objectStore(KV_STORE).get(READY_KEY);
  const allReq = tx.objectStore(TX_STORE).getAll();
  await done(tx);
  if (!readyReq.result && allReq.result.length === 0) return null;
  return allReq.result;
}

// 바뀐 명세서만 쓰고 지운 명세서만 지운다(한 트랜잭션). 처음 준비 표시도 함께 남긴다.
export async function writeTransactionChanges(puts = [], deleteIds = []) {
  const db = await openDb();
  const tx = db.transaction([KV_STORE, TX_STORE], 'readwrite');
  const store = tx.objectStore(TX_STORE);
  puts.forEach((t) => store.put(t, String(t.id)));
  deleteIds.forEach((id) => store.delete(String(id)));
  tx.objectStore(KV_STORE).put(true, READY_KEY);
  return done(tx);
}

// 다른 창이 바꿨다고 알려 온 명세서들을 다시 읽는다. 지워져서 없는 것은 결과에 없다.
export async function readTransactions(ids) {
  const db = await openDb();
  const tx = db.transaction(TX_STORE, 'readonly');
  const store = tx.objectStore(TX_STORE);
  const reqs = ids.map((id) => store.get(String(id)));
  await done(tx);
  return reqs.map((r) => r.result).filter(Boolean);
}
