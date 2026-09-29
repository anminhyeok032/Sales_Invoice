# Tradetax.gdb 읽기

`private-data/Tradetax.gdb` 는 기존 거래명세서 프로그램이 쓰던 데이터베이스다.
파일 헤더를 뜯어보면 **InterBase 6 / Firebird 1.x 포맷(ODS 10.0, 페이지 4096바이트,
dialect 1)** 이다.

문제는 이 포맷을 여는 방법이다.

- Firebird 3 이상은 ODS 11 미만을 **아예 열지 못한다.** 이 파일을 열려면 Firebird 2.5
  이하가 필요하다.
- 이 PC에는 `fbclient.dll` / `fbembed.dll` / `gds32.dll` 이 하나도 없고,
  파이썬 `fdb` · `firebird-driver` 도 설치돼 있지 않다.
- 이 프로젝트는 서버가 없는 local-first SPA다. 데이터를 한 번 꺼내오면 되는 일에
  구버전 DB 서버를 설치해서 상주시킬 이유가 없다.

그래서 **디스크 페이지를 직접 파싱하는 순수 파이썬 리더**를 넣었다. 설치할 것도,
띄울 서버도 없다. 표준 라이브러리만 쓴다.

## 사용법

```bash
python tools/gdb/export_tradetax.py --schema    # 테이블 구조 출력
python tools/gdb/export_tradetax.py --images    # private-data/export/ 로 내보내기
python tools/gdb/export_tradetax.py --raw       # 컬럼명 그대로 통째로 덤프
python tools/gdb/verify_tradetax.py             # 자체 검증 (14개 검사)
```

출력물은 `private-data/export/` 에 들어간다 (gitignore 대상).

| 파일 | 내용 |
| --- | --- |
| `suppliers.json` | 공급자(자사) 정보 2건 — `PUSER` |
| `customers.json` | 거래처 133건 — `CUSTOMER` |
| `transactions.json` | 거래명세서 헤더 + 품목 줄 — `TRADFLST` + `RDESLST` |
| `price_memory.json` | 품목별 기억된 단가 5,306건 — `CUSTMCOST` |
| `stamp_N.bmp` | 도장 이미지 — `PUSER.DJIMG` BLOB |
| `tradetax-import.json` | **앱에서 가져올 파일** (3.1MB, 아래 참고) |

## 앱에 넣기

`저장된 내역 조회` 탭 → **기존 프로그램 데이터 가져오기** → `private-data/export/tradetax-import.json` 선택.

몇 건이 새로 들어오고 몇 건을 덮어쓰는지 먼저 보여주고, 확인을 눌러야 반영된다.
같은 파일을 두 번 넣어도 문서번호(`JPNO`) 기준으로 덮어쓰기 때문에 중복되지 않는다.
거래처도 함께 들어가는데, **이미 있는 상호는 건드리지 않고 없는 것만 추가**한다
(앱에서 고쳐뒀거나 `업체목록.xls`와 맞춰둔 내용을 예전 데이터로 덮어쓰지 않기 위해).

### 저장 위치가 localStorage가 아니다

기존 내역 전체는 앱 형식으로 줄여도 3MB가 넘고, localStorage는 UTF-16으로 계산하므로
약 5.6MB를 차지한다 — 브라우저 한도(보통 5MB)를 넘는다. 그래서 저장된 내역만
**IndexedDB**(`거래명세서-자동-관리-data`)로 옮겼다. 나머지 상태는 localStorage 그대로다.
자세한 건 `src/lib/transactionDb.js`, `src/store.js`.

키 이름은 앱 스키마(`src/lib/companyExcelSync.js`, `src/lib/transactionItems.js`)에
맞춰뒀다 — `name` / `president` / `regNo` / `businessType` / `businessItem` /
`address` / `phone`, 품목은 `date` / `name` / `spec` / `unit` / `qty` / `price` /
`supply` / `tax` / `note`.

## 원본 스키마

```
PUSER      공급자(자사).  HCD, SANGHO(상호), MNAME(대표), MTEL, EMAIL, UPTEA(업태),
           UPJOG(업종), BSNO(사업자번호), ADDR, A~EETC, DJUSER, DJIMG(도장 BMP)
CUSTOMER   거래처.  HCD, MCD, SANGHO, MNAME, MTEL, UPTEA, UPJOG, BSNO, ADDR,
           EMAIL, METC, TAG
TRADFLST   명세서 헤더.  JPNO(문서번호=PK), IDAY(작성일 'YYYY.MM.DD'), JKYU(건명),
           거래처 정보 사본, IMNY(공급가액), IVAT(세액), MCD, GCD, CANP, ETC, TAG
RDESLST    명세서 품목.  JPNO(→TRADFLST), ORDRF(줄 순서), MDAY, PNAME, PSTAN(규격),
           PUNIT, INO(수량), ICOST(단가), IMNY(공급가액), IVAT, ETC, TAG
CUSTMCOST  품목 단가 기억.  HCD, PNAME, PSTAN, PUNIT, ICOST
```

## 검증

`verify_tradetax.py` 는 리더의 자기 주장을 믿지 않는다. 서로 독립적으로 얻은 두 결과를
맞대보거나, 원래 프로그램이 지켰어야 할 불변식을 검사한다.

1. **페이지 탐색** — 파일 전체를 훑어 찾은 데이터 페이지 집합과, Firebird 자체
   pointer page 목록을 따라간 집합이 일치하는지 (959페이지 전부 일치)
2. **트랜잭션 가시성** — TIP(transaction inventory)를 읽어 반환한 31,428행이 전부
   커밋된 트랜잭션 소속인지
3. **레코드 복원** — 모든 레코드가 선언된 포맷 길이만큼 온전히 압축 해제되는지
4. **참조 무결성** — `RDESLST.JPNO` 가 전부 `TRADFLST` 에 존재하고 PK가 유일한지
5. **금액 정합성** — 헤더 합계 = 품목 합계 (전부 일치)
6. **BLOB** — 도장 이미지가 BMP 헤더의 선언 크기와 정확히 같은 길이인지
7. **인코딩** — 문자열 209,943개가 전부 올바른 CP949인지

결과: **14 passed, 0 failed.**

## 알아둘 것

- **`rhd_chain` 플래그(2)가 붙은 레코드는 MVCC 구버전이다.** 살아있는 행으로 착각하면
  안 된다. 이 파일에는 11건 있고, 그중 4건은 삭제된 명세서의 이전 버전이라 헤더 없는
  고아 품목처럼 보인다.
- **CP949 문자 중간에서 잘린 문자열이 519개 있다** (전체의 0.25%). 원래 프로그램이
  바이트 단위로 잘라 저장한 것이고 리더 문제가 아니다 — 마지막 1바이트만 버리면 전부
  정상 디코딩된다. 리더는 깨진 글자(`�`) 대신 잘린 바이트를 떼고 돌려준다.
- **같은 (연도, 월, 거래처명) 조합에 명세서가 여러 건 있다** — 575개 조합, 최대 13건.
  앱의 `saveTransaction`은 원래 그 조합으로 기존 내역을 찾아 덮어썼기 때문에, 가져온
  내역을 수정해 저장하면 같은 달의 다른 명세서를 지웠을 것이다. 지금은 `id`가 있으면
  `id`로 먼저 찾는다 (`src/store.js`). 새로 만드는 명세서는 `id`가 없으므로 동작이 그대로다.
- **`TRADFLST.MCD` 는 신뢰할 수 있는 외래키가 아니다.** 명세서는 거래처 정보를 자체
  복사해 들고 있고(비정규화), 상당수가 `MCD=0`(임시 거래처), 나머지 불일치분은
  거래처가 지워졌거나 코드가 재사용된 경우다. **거래처 매칭은 `SANGHO`(상호)로 해야 한다.**
- `JPNO` 는 두 세대가 섞여 있다 — 옛 형식 `YYMMDDA00001`(1,101건)과
  현재 형식 `YYMMDDHHMMSS` + 영문 1자(1,589건).
- `IDAY` 는 사용자가 직접 고칠 수 있는 값이라 `JPNO` 의 생성 시각과 자주 다르다.
  작성일은 `IDAY` 를 쓸 것.
- 리더는 **읽기 전용**이다. `.gdb` 에 쓰지 않는다.
