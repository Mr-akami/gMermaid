# 0002 — XState は StateIR の第2プロジェクション（マスターを増やさない）

Status: Accepted (2026-09-21)

## Context

State 図を「Mermaid テキスト」だけでなく「XState v5 マシン」としても編集
したい。コードペインに XState タブを置き、そこに書いた内容が内部モデルに
なり、Mermaid テキストが自動生成される。逆方向（Mermaid → XState）も可能な
限り成立させる。

ADR 0001 の大前提は **マスターはひとつ（IR）** であり、他はすべて派生。
ここで素直に実装すると「Mermaid テキスト」と「XState テキスト」という2つの
マスターが並び、どちらが正かを常に調停する羽目になる。それは避ける。

もう一つの制約がある。XState は Mermaid が言葉を持たない情報を大量に持つ
（entry/exit アクション、invoke、ガード、遅延、context、parallel の意味論）。
GUI で1回操作しただけでそれらが黙って消えるなら、この一連の作業でずっと
潰してきた失敗そのものになる。**IR に載せるか、目に見える形で拒むか**の
どちらかしか許さない。

## 検討した案

- **(a) XState を StateIR の第2テキスト射影とし、Mermaid が言えない部分は
  IR 上の任意拡張（canvas は無視）に載せる。**
- (b) Mermaid と XState の両方が射影する、より豊かな State IR を新設し、
  Mermaid をより情報欠落の大きい射影とする。

(b) は「豊かな IR」の中身が結局 XState のスキーマそのものになる。State の
縦スライス（parser / codegen / layout / renderer / reducer / GUI）は既に
`StateIR` の形（`states[] / transitions[] / notes[]` とフラットな id）に依存
しており、それを XState 風の入れ子モデルに置き換えると、図の意味は1ミリも
変わらないのに全レイヤを書き換えることになる。新しい概念も増えない。

## Decision

**(a) を採用する。** `StateIR` は唯一のマスターのまま、Mermaid と XState は
その2つのテキスト射影とする。

```
XState text ──parse──┐                 ┌──codegen──> XState text
                     ├──>  StateIR  ───┤
Mermaid text ─parse──┘   (唯一のマスター) └──codegen──> Mermaid text
                             │
                             └── layout ──> render（canvas は拡張を見ない）
```

- 追加は `packages/ir/src/xstateMeta.ts` の任意フィールドのみ:
  `StateNode.xstate` / `StateTransition.xstate` / `StateIR.xstate`。
  layout・renderer・reducer は一切参照しない（reducer はスプレッドで運ぶだけ）。
- 新パッケージ `packages/xstate`（`parseXStateMachine` / `stateToXState`）。
  `mermaid-parser` / `mermaid-codegen` と同じ位置づけの、もう一組の parser と
  codegen。

### 拡張に「二重の真実」を置かない

拡張に入れてよいのは **コア IR がまだ言っていないことだけ**。具体的には:

- 遷移のイベント名・ガード・アクションは `StateTransition.label` が唯一の
  置き場で、UML と同じ `EVENT [guard] / action1, action2` の形で持つ
  （`packages/xstate/src/signature.ts`）。`label` の別解釈として
  `event`/`guard`/`actions` フィールドを増やすことはしない。増やせば
  「ラベルを直した」と「イベント名を直した」が食い違う。
- 状態の表示名は `StateNode.label` が唯一の置き場で、XState の
  `description` と相互変換する。
- 並行性は「`--` リージョンが2つ以上あること」が唯一の真実で、
  `xstate.parallel` は **リージョンが1つ以下の退化ケースでしか立てない**
  （判定は OR なので、両者が矛盾する状態を作れない）。
- `context` と `setup({ … })` の引数は**ソーステキストのまま**運ぶ。中身は
  関数であり、解釈しないと決めたものを解釈したふりで持たない。

### GUI 往復で消えないようにする2つのマージ

テキストを1つ編集するたびに、その parser は IR を丸ごと作り直す。だから
commit 経路にマージを1枚挟む（`packages/ir/src/xstateMeta.ts`）:

- `mergeXStateDetail(prev, next)` — Mermaid ペインの commit に使う。id が
  生き残った state と、`from`/`to`/`label` が一致する transition に、前の IR
  の XState 詳細を戻す。テキストから消された要素の詳細は一緒に消える（それは
  ユーザーが消したのだから正しい）。
- `mergeMermaidDetail(prev, next)` — XState ペインの commit に使う。XState が
  持たない note と `direction` を戻す。

オートセーブも同様に、`.mmd` の隣に XState テキストを sidecar として保存する
（`gmermaid-xstate:doc:state`）。これが無いとリロード1回で entry アクションが
全部消える。

### 受け入れる XState のサブセット（評価は一切しない）

XState のマシンは JavaScript であってデータではない。**ユーザー入力を eval
しない。** `acorn` で AST だけを取り、そこからリテラルを読む
（`packages/xstate/src/read.ts`）。`meriyah` でも同じことはできるが、acorn は
Vite/Rollup 経由で既にエコシステムに居り、`parseExpressionAt` で「裸の
`{ … }`」を拾えるので選んだ。

受け入れる:

- `createMachine({ … })` / `setup({ … }).createMachine({ … })` / 裸の `{ … }`。
  `import` 文と代入先の束縛は無視する。
- config の中はオブジェクト・配列・文字列・数値・真偽値・`null`・負数・
  `${}` を含まないテンプレート。コメントと末尾カンマは通る。
- アクションとガードは文字列名か `{ type, params }`。
- `context` と `setup({ … })` の引数は読まずに原文のまま持ち回る。

拒む（理由を添えて）:

- インライン関数・呼び出し式・識別子参照・スプレッド・計算キー・`new`
  — 「`setup({ … })` に名前を付けて文字列で参照してください」と言う。
  したがって `and()` / `or()` / `not()` / `stateIn()` の合成ガードは対象外。
- v4 の綴り（`cond` / `onEntry` / `services` / `internal` / `Machine()` …）
  は v5 の綴りを名指しして拒む。
- 知らないキーは黙って捨てず、キー名を出して拒む。捨てられた `invoke` は
  消された振る舞いと同じだから。
- ルートの `type: "parallel"` と、ルート直下の `on`/`always`/`after`
  — Mermaid に描く場所が無い。

## 各射影が落とすもの

**XState → Mermaid（`stateToMermaid`）が描かないもの**（IR には残る）:
entry/exit アクション、invoke、onDone、tags、meta、output、context、setup、
`reenter`、遷移の description、`type: "history"`（ただの箱になる）、
2つ目以降の `final`（ただの箱になる）、machine id。

**Mermaid → XState（`stateToXState`）が言えないもの**:

- note は機械の一部ではない（警告する）。
- 図全体・ブロックごとの `direction` はレイアウトの話で、機械には無い。
- `<<choice>>` / `<<fork>>` / `<<join>>` は普通の状態として出る。
- **リージョンに複数の状態が居る場合**。XState のリージョンは「状態そのもの」
  で、Mermaid のリージョンは「複数を入れられる帯」。住人が1つならその状態を
  そのままリージョンにするが、複数なら合成した状態（`region1` …）で包み、
  **どれを包んだかを警告として出す**。黙って形を変えない。

警告はコードペインの `.code-warnings` にそのまま出る。

## Consequences

- XState タブで書いた内容は IR になり、canvas と Mermaid テキストがそれに
  追従する。逆も同じ。どちらのタブも「もう一方が勝つ」経路を持たない。
- ラベル文法が2つの射影の蝶番になった。`A --> B : X` の `X` は今後
  「イベント名」として読まれる。ラベル無しの矢印は `always`（完了遷移）。
  これは UML の慣習どおりだが、Mermaid 単体で使っていた人には新しい意味が
  付く。
- `packages/xstate` は `xstate` v5 を devDependency に持ち、生成した config を
  **本物の `createMachine` に食わせて**検証する。mermaid.js に対して
  `mermaid-codegen` がやっているのと同じ規律。
- 合成ガード（`and`/`or`/`not`/`stateIn`）と、`params` に関数を取る形は
  サブセット外。必要になったら「setup 側に名前を付ける」で回避できる。
