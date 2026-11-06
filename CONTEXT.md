# gMermaid — Ubiquitous Language

## 用語集

- **IR (Intermediate Representation / 中間モデル)** — 図種ごとに独立した型（FlowchartIR / ClassIR / SequenceIR）。共有するのは「id を持つ要素」「選択・履歴」等の横断機構のみ。図の唯一のマスターデータ。GUI 操作もコード編集もすべて IR への更新として適用される。Mermaid コードとレンダリング済み SVG はどちらも IR から導出されるビュー。
- **手動座標の唯一の例外: 象限図 (quadrantChart)** — 点の `x`/`y`（0..1）は見た目ではなく**データそのもの**なので IR が保持し、GUI は点のドラッグ（またはプロパティの数値入力）で IR の座標を直接書き換える。レイアウトエンジンは座標を決めず、プロット領域への線形写像（`quadrantToPlot` / `plotToQuadrant`）だけを担う。ドラッグ中は ViewState（一時表示）で、離した時に `movePoint` 1回 = undo 1ステップ。点のスタイル（`radius` / `color` / `stroke-*` / `:::class` / `classDef`）はフローチャート以外の図種と同じく許容して捨て、ParseWarning を出す。
- **ペイント (Paint)** — フローチャートだけが色を IR に持つ: `classDefs`、ノード/サブグラフの `classes`・`style`、エッジの `style`（Mermaid では `linkStyle <index>`）。値は Mermaid の `key:value` 文字列のまま保持し、レイアウトが `flowchartPaint` で解決して renderer へ渡す。**差分マーク (Diff Mark)** — PR の Before/After を示す既定の classDef `added` / `removed` / `changed`（`FLOWCHART_DIFF_MARKS`）。
- **Mermaid コード** — IR からエクスポート/インポートされるテキスト形式。マスターではない。IR で表現できてもMermaid 構文にない情報（座標など）は含まれない。
- **自動レイアウト (Auto Layout)** — ノード・フラグメント等の座標は常にレイアウトエンジンが計算する。手動座標は保持しない（例外は象限図、下記）。位置の変更は IR の構造変更（順序・所属の変更）→ 再レイアウトとして表現される。
- **レイアウトエンジン (Layout Engine)** — IR から座標付きレイアウトを計算する独立パッケージ。
- **コード検証 (Validation)** — コードペインの入力は Mermaid.js のパーサで検証する。不正な間は IR を更新せず、エラーを表示する。
- **対象図種 (Diagram Kinds)** — 14種。flowchart、sequence、state、class、gantt、requirement、journey、mindmap、timeline、usecase、er、gitGraph、quadrantChart、architecture。
- **Codegen** — IR → Mermaid コード生成。第1弾から対象。
- **Parser** — Mermaid コード → IR。図種ごとに後追いで実装（第1弾は Mermaid.js による検証のみ）。
- **プロパティウインドウ (Property Window)** — 要素クリックで開くフローティングウインドウ。矢印種別などの要素属性を編集する。
- **ViewState** — 選択・ホバー・パン/ズーム・ドラッグ中の一時状態。IR には含まれない。ViewState の変更で再レイアウトは走らない。
- **Alt フラグメント (Combined Fragment)** — シーケンス図の alt/opt/loop 等の枠。矢印とのオーバーレイ・範囲変更を GUI で扱う対象。フラグメントは「どのメッセージ群を包含するか」で定義され、枠のドラッグは座標変更ではなく包含範囲（IR の構造）の変更。枠は半透明背景としてメッセージの下に描画し、当たり判定は枠線とラベルタブのみ。else 区切り線のドラッグで分岐間のメッセージ移動が可能。
- **プロジェクション (Projection)** — IR から導出されるテキスト表現。State 図は Mermaid と **XState v5 マシン**の2つを持ち、どちらもマスターではない（ADR 0002）。Mermaid が綴れない情報（entry/exit、invoke、ガード、遅延、context、setup）は IR の任意拡張 `xstate` に載り、canvas とレイアウトは無視する。射影が言えないことは黙って落とさず、コードペインに警告として出す。
- **XState サブセット** — コードペインが受け取る XState の範囲。ユーザー入力は**評価しない**（acorn で AST のみ）。config はリテラルのみ、アクション・ガード・アクター・遅延は `setup({ … })` に名前を付けて文字列参照。範囲外は理由を名指しして拒む。
