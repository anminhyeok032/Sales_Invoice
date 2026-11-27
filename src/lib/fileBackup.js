// 내 PC의 파일 하나에 저장된 내역을 자동으로 덮어쓰는 "연결된 백업 파일" (JSON 백업, 엑셀 보기 파일 공용).
//
// 파일 연결 정보(FileSystemFileHandle)는 IndexedDB에 두고, 내역·거래처·공급자 등이 바뀌면 잠깐 모았다가
// 파일 전체를 새로 쓴다. 브라우저가 파일 쓰기 허락을 잊었으면(다시 켠 뒤 등) 자동으로는 묻지 않고
// "다시 연결" 상태로 둔다 — 허락 창은 사용자가 단추를 눌렀을 때만 띄울 수 있다.
//
// 상태: checking | unsupported | disconnected | needs-permission | connected  (+ fileName, savedAt, error, busy)
//
// 크롬은 파일 쓰기 허락을 브라우저를 다시 켜면 거둔다. 기본 설정('사용하지 않는 사이트의 권한 삭제')에서는
// 한동안 쓰지 않은 사이트의 허락도 거둔다. 그래서 오랜만에 열면 연결이 '풀린' 것처럼 보인다(연결 정보는 남아 있다).
// reaskOnClick을 켜면 그런 상태일 때 앱 안 어디든 처음 누르는 순간 허락을 다시 묻는다(허락 창은 사용자가
// 무엇을 눌렀을 때만 띄울 수 있다). 창에서 '모든 방문에서 허용'을 고르면 다음부터는 묻지 않는다.
import { useSyncExternalStore } from 'react';
import useStore from '../store';
import { saveHandle, loadHandle, clearHandle, isFileSystemAccessSupported } from './fileHandleStore';

// checkExisting(file): 이미 있는 파일을 연결할 때 덮어써도 되는지 본다. 괜찮으면 null, 아니면 확인 창에 보일 경고 글.
export function createFileBackup({ handleKey, picker, makeContent, delayMs, watch, reaskOnClick = false, checkExisting }) {
  let status = { state: 'checking', fileName: '', savedAt: '', error: '', busy: false };
  const listeners = new Set();
  const setStatus = (patch) => {
    status = { ...status, ...patch };
    listeners.forEach((l) => l());
  };

  let handle = null;
  let timer = null;
  let started = false;
  let writing = null;   // 쓰는 중이면 그 Promise
  let again = false;    // 쓰는 동안 또 바뀌었으면 끝난 뒤 한 번 더

  async function write() {
    if (!handle) return;
    // 저장소에서 내역을 다 읽기 전이면 쓰지 않는다 — 빈 목록으로 파일을 덮어쓰면 안 된다.
    if (!useStore.getState().transactionsLoaded) return;
    if (writing) { again = true; return; }
    writing = (async () => {
      try {
        if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          setStatus({ state: 'needs-permission' });
          armReask();
          return;
        }
        setStatus({ busy: true });
        const content = await makeContent(useStore.getState());
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        setStatus({ state: 'connected', savedAt: new Date().toLocaleTimeString(), error: '' });
      } catch (err) {
        setStatus({ error: `저장 실패: ${err.message}` });
      } finally {
        setStatus({ busy: false });
      }
    })();
    await writing;
    writing = null;
    if (again) { again = false; await write(); }
  }

  // 허락이 꺼져 있으면 다음 클릭 때 한 번 다시 묻는다. 그 클릭이 '다시 켜기' 단추면(data-file-reconnect)
  // 단추가 직접 묻으므로 여기서는 건너뛴다(허락 창이 두 번 뜨지 않게).
  let armed = false;
  function armReask() {
    if (!reaskOnClick || armed || typeof document === 'undefined') return;
    armed = true;
    const onDown = async (e) => {
      if (e.target instanceof Element && e.target.closest('[data-file-reconnect]')) return;
      document.removeEventListener('pointerdown', onDown, true);
      armed = false;
      if (!handle || status.state !== 'needs-permission') return;
      try {
        if ((await handle.requestPermission({ mode: 'readwrite' })) === 'granted') {
          setStatus({ state: 'connected', error: '' });
          write();
        }
      } catch { /* 허락 창을 띄울 수 없는 때(예: 창이 뒤에 있음) — 단추로 다시 켤 수 있다 */ }
    };
    document.addEventListener('pointerdown', onDown, true);
  }

  function schedule() {
    if (status.state !== 'connected') return;
    clearTimeout(timer);
    timer = setTimeout(write, delayMs);
  }

  async function attach(picked) {
    await saveHandle(handleKey, picked);
    handle = picked;
    setStatus({ state: 'connected', fileName: picked.name, error: '' });
    await write();
  }

  return {
    useStatus: () => useSyncExternalStore(
      (l) => { listeners.add(l); return () => listeners.delete(l); },
      () => status,
    ),

    // 앱 시작 시 한 번(내역을 다 읽은 뒤). 연결해 둔 파일이 있으면 이어서 쓴다.
    async init() {
      if (started) return;
      started = true;
      if (!isFileSystemAccessSupported()) {
        setStatus({ state: 'unsupported' });
        return;
      }
      handle = await loadHandle(handleKey).catch(() => null);
      if (!handle) {
        setStatus({ state: 'disconnected' });
      } else {
        const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
        setStatus({ state: granted ? 'connected' : 'needs-permission', fileName: handle.name });
        if (!granted) armReask();
        // 앱을 열 때 한 번 최신 상태로 다시 쓴다. 지난번에 저장 직후 바로 창을 닫았거나(모아 쓰는 시간 안),
        // 다른 PC·브라우저에서 바뀐 것이 있어도 파일이 앱과 맞춰진다. 허락이 없으면 묻지 않고 넘어간다.
        if (granted) write();
      }
      useStore.subscribe((state, prev) => {
        if (watch.some((key) => state[key] !== prev[key])) schedule();
      });
    },

    // 새 파일을 만들어 연결(저장 창). 취소하면 아무것도 바꾸지 않는다.
    async connect() {
      let picked;
      try {
        picked = await window.showSaveFilePicker(picker);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        throw err;
      }
      await attach(picked);
    },

    // 이미 있는 파일을 골라 연결(열기 창). 그 파일에 앱 내용을 덮어쓰므로, 앱이 만든 파일이 아니면 먼저 묻는다.
    async connectExisting() {
      let picked;
      try {
        [picked] = await window.showOpenFilePicker({ types: picker.types, multiple: false });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        throw err;
      }
      if ((await picked.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        throw new Error('파일에 쓰도록 허락하지 않아서 연결하지 않았습니다.');
      }
      const warning = checkExisting ? await checkExisting(await picked.getFile()) : null;
      if (warning && !window.confirm(`${warning}\n\n연결하면 이 파일의 내용이 모두 앱의 저장 내역으로 바뀝니다. 계속할까요?`)) return;
      await attach(picked);
    },

    // 허락이 풀린 경우. 단추를 눌렀을 때만 부른다.
    async reconnect() {
      if (!handle) return;
      if ((await handle.requestPermission({ mode: 'readwrite' })) === 'granted') {
        setStatus({ state: 'connected', error: '' });
        await write();
      }
    },

    async disconnect() {
      clearTimeout(timer);
      await clearHandle(handleKey);
      handle = null;
      setStatus({ state: 'disconnected', fileName: '', savedAt: '', error: '' });
    },

    // 지금 바로 쓰기(연결돼 있을 때만).
    writeNow: () => write(),
  };
}
