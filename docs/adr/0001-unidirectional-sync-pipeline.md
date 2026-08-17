# 0001 — 単方向・同期パイプライン（イベントバス不採用）

Status: Accepted (2026-08-17)

## Context

gMermaid は IR を唯一のマスターとする Mermaid GUI エディタ。Renderer と Layout(Geometry) を疎結合に分離しつつ、pub-sub/イベントバスによる「関数ジャンプで追えないコード」を避けたい。

## Decision

データフローは明示的な同期関数呼び出しの単方向パイプラインとする:

```
app: updateIR() → layout(ir, measurer) → render(layoutResult)
```

- **上り（ユーザー入力）は React props コールバックのみ。** コールバックが運ぶのは「ユーザー意図」（例: `nodeMoved(id, pos)`）であり、IR 更新関数そのものは渡さない。
- **layout は純関数。** テキスト計測は `measurer` インターフェースとして注入する（実行時: canvas measureText / テスト: スタブ）。DOM 依存を layout 内部に入れない。
- **layoutResult は id のみを持ち、IR オブジェクトへの参照を含めない。** renderer が IR を直接読めないことを型で強制する。
- **IR はイミュータブル更新。** 参照同一性を将来の部分メモ化のキャッシュキーに使えるようにする。
- **view-transient 状態の例外:** ドラッグ中の delta 等の一時状態は React state に置き、確定時（drop 等）に一度だけ `updateIR()` する。これは「IR が唯一のマスター」の唯一の明示的例外。
- **undo/redo は IR スナップショット履歴で実装。** 更新は `updateIR` 一箇所に集約する。

## 追加規約（ピアレビューにより採択）

- **ViewState の分離:** 選択・ホバー・パン/ズーム等は IR ではなく `ViewState` に置き、`render(layoutResult, viewState)` とする。ViewState の変更で relayout は走らない。パン/ズームは SVG ルートの transform で実現する。
- **ヒットテストの使い分け:** クリック/ホバーは DOM に任せる（renderer が `data-node-id` を出力し、イベントから id で IR に戻す）。矩形選択・スナップ・整列など DOM で取れないものだけ layout の幾何を使う。
- **LayoutResult の純データ性は機械的に守る:** `JSON.parse(JSON.stringify(x))` が同値であることをテストで保証（関数・DOM 参照・クラスインスタンスの混入を検出）。
- **ID 契約:** id は branded type（例: `NodeId`）。IR → LayoutResult → DOM 属性 → イベント → IR の往復テストを1本持つ。
- **座標系:** LayoutResult は diagram space のみ。screen 座標との変換は境界の `toScreen` / `toDiagram` に限定する。
- **updateIR はアクション指向:** セッターではなく意味のあるアクション（判別可能ユニオン）を受け、undo のトランザクション境界（ドラッグ1回 = 1履歴）をタグ付けできる形にする。
- **テスト3層:** layout = golden test（IR → 座標 JSON）、renderer = スナップショット（LayoutResult → SVG 文字列）、reducer = 純関数テスト。パイプライン完成直後に各1本通す。この3つが書きにくくなったら層が破れているサイン。

## Consequences

- コードは呼び出しスタックで追跡可能。イベントバス・グローバル subscribe 連鎖は禁止。
- 初版はフル再計算（updateIR ごとに全レイアウト）。性能問題が出たら参照同一性ベースのメモ化で対処。
- コラボ編集・プラグイン等の将来要件は updateIR 集約により後付け可能なため、現時点で pub-sub を導入する理由はない。
