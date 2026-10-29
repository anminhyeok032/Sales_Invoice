// 내 PC의 파일 하나에 저장된 내역을 자동으로 덮어쓰는 "연결된 백업 파일" (JSON 백업, 엑셀 보기 파일 공용).
//
// 파일 연결 정보(FileSystemFileHandle)는 IndexedDB에 두고, 내역·거래처·공급자 등이 바뀌면 잠깐 모았다가
// 파일 전체를 새로 쓴다. 브라우저가 파일 쓰기 허락을 잊었으면(다시 켠 뒤 등) 자동으로는 묻지 않고
// "다시 연결" 상태로 둔다 — 허락 창은 사용자가 단추를 눌렀을 때만 띄울 수 있다.
//
// 상태: checking | unsupported | disconnected | needs-permission | connected  (+ fileName, savedAt, error, busy)
import { useSyncExternalStore } from 'react';
import useStore from '../store';
import { saveHandle, loadHandle, clearHandle, isFileSystemAccessSupported } from './fileHandleStore';

export function createFileBackup({ handleKey, picker, makeContent, delayMs, watch }) {
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

  function schedule() {
    if (status.state !== 'connected') return;
    clearTimeout(timer);
    timer = setTimeout(write, delayMs);
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
        // 앱을 열 때 한 번 최신 상태로 다시 쓴다. 지난번에 저장 직후 바로 창을 닫았거나(모아 쓰는 시간 안),
        // 다른 PC·브라우저에서 바뀐 것이 있어도 파일이 앱과 맞춰진다. 허락이 없으면 묻지 않고 넘어간다.
        if (granted) write();
      }
      useStore.subscribe((state, prev) => {
        if (watch.some((key) => state[key] !== prev[key])) schedule();
      });
    },

    async connect() {
      const picked = await window.showSaveFilePicker(picker);
      await saveHandle(handleKey, picked);
      handle = picked;
      setStatus({ state: 'connected', fileName: picked.name, error: '' });
      await write();
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
