// 기존 프로그램 데이터 파일(Tradetax.gdb) 연결: 한 번 골라 두면 다음부터는 단추 하나로 다시 읽는다.
//
// 파일 자리(FileSystemFileHandle)만 IndexedDB에 기억한다(fileHandleStore.js, 백업 파일 연결과 같은 방식).
// 파일 내용은 읽을 때마다 새로 읽으므로, 기존 프로그램에서 새로 쓴 명세서도 '다시 읽기'로 들어온다.
// 브라우저를 다시 켜면 읽기 허락을 다시 물을 수 있다 — 허락 창은 단추를 눌렀을 때만 띄울 수 있다.
import { saveHandle, loadHandle, clearHandle, isFileSystemAccessSupported, ensurePermission } from './fileHandleStore';

const HANDLE_KEY = 'legacyGdbHandle';

export const isGdbLinkSupported = isFileSystemAccessSupported;

export async function loadGdbLink() {
  if (!isFileSystemAccessSupported()) return null;
  return loadHandle(HANDLE_KEY).catch(() => null);
}

// 파일 고르기 창을 띄워 연결한다. 취소하면 null.
export async function pickGdbLink() {
  let handles;
  try {
    handles = await window.showOpenFilePicker({
      types: [{ description: '기존 프로그램 데이터 (Tradetax.gdb)', accept: { 'application/octet-stream': ['.gdb'] } }],
      multiple: false,
    });
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
  await saveHandle(HANDLE_KEY, handles[0]);
  return handles[0];
}

export const clearGdbLink = () => clearHandle(HANDLE_KEY);

// 연결한 파일의 지금 내용(File). 단추를 눌렀을 때 부른다(허락 창이 뜰 수 있다).
export async function readGdbLink(handle) {
  if (!(await ensurePermission(handle, 'read'))) {
    throw new Error('파일을 읽도록 허락하지 않았습니다. 다시 읽기를 누르고 허락해 주세요.');
  }
  try {
    return await handle.getFile();
  } catch (err) {
    if (err?.name === 'NotFoundError') {
      throw new Error(`${handle.name} 파일을 찾을 수 없습니다. 옮기거나 이름을 바꿨으면 '다른 파일 연결'로 다시 골라 주세요.`, { cause: err });
    }
    if (err?.name === 'NotReadableError') {
      throw new Error(`${handle.name} 파일을 읽을 수 없습니다. 기존 프로그램이 파일을 쓰고 있으면 기존 프로그램을 닫고 다시 읽어 주세요.`, { cause: err });
    }
    throw err;
  }
}
