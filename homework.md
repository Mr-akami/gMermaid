# Homework — 残っている宿題

レビュー・実装の過程で意図的に先送りした項目。着手時は `docs/adr/0001-unidirectional-sync-pipeline.md` と `CONTEXT.md` の規約に従うこと。

## 機能

### pan / zoom
- ViewState に viewport（scale, offset）を持たせ、SVG ルートの transform で実現する（再レイアウトは走らせない — ADR 0001）。
- screen ⇔ diagram 座標変換を境界の `toScreen` / `toDiagram` に集約する。現在 `FlowchartView` 等は viewBox を layout サイズに直結させているため、viewport state への置き換えが必要（二重管理にしない）。
- 各 View の `diagramPoint()`（pointer 座標→diagram 座標）も viewport を考慮する形に変える。

### クラス図の自己関連（TreeNode → TreeNode）
- 現在 `applyClassAction` の `addRelation` が `from === to` を拒否している（`classActions.ts`）。
- 実装方針（レビュアーのコスト見積もり済み）: dagre には self-edge を渡さず、layout 後にノード矩形から右側へ張り出す矩形迂回パスを自前合成する。シーケンス図のセルフメッセージ（`SELF_MSG_EXTRA`）と同じ考え方。
- 同一ノードに複数の自己関連が付く場合は本数 × オフセットで重なりを回避。
- `size.w` の計算に右への張り出し分を含めること（空クラス図の -Infinity と同種の見落とし注意）。

### loop spec の IR 構造化（B-2）
- 現在 loop の (min,max)/exit は条件文字列 `"(min,max) exit"` に文字列として埋め込んでおり、compose/decompose が非可逆（Exit 欄に `(1,2) foo` と書くと Min/Max に吸われる）。
- `Branch.loopBounds?: { min: string; max: string }` として構造で持ち、`condition` は exit テキスト専用にする。codegen が `(min,max) exit` を組み立て、曖昧な分解はパーサの import 一回だけに閉じ込める。
- 数字制約（B-1: inputMode=numeric + 非数字除去）は実装済み。

## リファクタリング

### ポインタ処理の共有フック化（H）
- `FlowchartView` / `ClassView` / `SequenceView` の pointerdown/move/up/cancel 処理がほぼ重複している（判定ルールは3つとも一致: 5px Chebyshev 閾値、pointerup ベースのクリック解決、常時 capture、button/isPrimary フィルタ）。
- `usePointerGestures` のような共有フックに括る。`PADDING` が Sequence=10 / 他=20 なのでパラメータ化すること。
- 今後この処理に手を入れる時は3箇所同時に直すこと（欠陥も3箇所共通になる構造）。

### reducer の「拒否」と「無変更」の区別（L2 横断整理）
- identity 保存 reducer は不正な操作を黙って no-op にする（例: メッセージが残るライフラインの削除、自己関連の追加）。ユーザーには「ボタンが効かない」としか見えない。
- 方針: UI 側で事前に可否判定してボタンを disable + 理由表示（ライフライン削除では実装済み — `messagesTouching` を export して使用）。3図種で同じパターンに揃える。
- 特に `addRelation` の自己関連拒否は、許可に倒さない場合でも理由を出すこと。

### setMembers の reducer 側検証（C5）
- メンバー名の文法（コロン・改行・空白・括弧）を reducer では検証していない。IR に直接入れると codegen→parse の往復で切り詰め・種別化け（属性がメソッドになる）が起きる。
- `MEMBER_NAME_RE` を ir 側に置き、`setMembers` で弾く（「検証は単一の入口で」の方針に揃える）。
- ついで: `setMembers` だけ同値比較がなく、同内容でも新参照を返す。identity 保存を揃える。

### omitUndefined ヘルパー（C6）
- `setStereotype` / `updateRelation` / `addRelation` 等が exactOptionalPropertyTypes 対応でフィールドを手で組み直しており、型にフィールドを足すとここだけ黙って落とす構造。
- `omitUndefined({...x, stereotype})` 的なヘルパーを1つ置いて全箇所で使う。

## CodePane / draft 系

### focused 中の base 失効バイパス（2a）
- `CodePane` はフォーカス中、`draft.base !== code` でも draft を表示し続ける（カーソル下の再フォーマット防止のため意図的）。
- 現状はキャンバス操作が必ず blur を伴うので踏めないが、**フォーカスを奪わずに IR を変える経路**（キーボードショートカット、自動整列ボタン、協調編集）を追加した時点で stale draft によるデータ損失が復活する。
- 対策: focused 中に `base !== code` を検出したら「図が変更されました（破棄 / このコードで上書き）」バナーを出してユーザーに選ばせる。

## テスト・検証

### mermaid.js との統合テスト（C4 残件）
- 自前 codegen の出力を実際に mermaid.js でパースさせる round-trip 統合テストが未実装。特にエッジラベルの `|"..."|` と `|` 入りラベルの干渉は mermaid 本体の挙動が未確認。
- parser の方言カバレッジ拡大（mermaid が受け付けるが gMermaid が落とす構文）もここで洗い出す。

## 仕様として確定済み（宿題ではないが忘れないこと）

- 空フラグメントは自動掃除しない（編集途中の足場として意図的に残す — L4）。
- ラベル・条件・名前の前後空白 trim は canonical 化の仕様（M1、テストで明文化済み）。
- レイアウト情報（座標）は保存しない。常に自動レイアウト（ADR 0001 / CONTEXT.md）。
