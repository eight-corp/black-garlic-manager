# 黒にんにく管理 GitHub Pages + Supabase版

Google Apps Script版の機能を、GitHub Pagesで配信できる静的HTMLとSupabaseのテーブルに移すための初期実装です。

## 構成

- `index.html` - 画面本体
- `styles.css` - 冷蔵庫管理に寄せたモバイル優先UI
- `app.js` - 入力、履歴、集計、予測、マスタ編集
- `config.js` - Supabase URL / anon key の固定設定
- `supabase/schema.sql` - テーブル、初期データ、RLS、権限
- `supabase/rpc.sql` - 在庫再計算、在庫監査などの補助RPC

## 初期設定

1. Supabase SQL Editorで `supabase/schema.sql` を実行する
2. 続けて `supabase/rpc.sql` を実行する
3. `config.js` にSupabase URLとanon keyを入れる

```js
window.APP_CONFIG = {
  supabaseUrl: "https://xxxxx.supabase.co",
  supabaseAnonKey: "eyJ..."
};
```

`config.js` を空のままにした場合は、初回表示時にブラウザ上でURLとanon keyを入力できます。その場合はその端末のlocalStorageにだけ保存されます。

## データ構造の考え方

- 作業者は冷蔵庫管理と同じ `workers` を共有します。
- 黒にんにく用のデータはすべて `black_garlic_` 接頭辞のテーブルに分離しています。
- 黒にんにく入力は `日付 + 室名 + 種別 + 収穫ロット` の組み合わせで上書きします。
- 在庫は `室名 + 種別 + 収穫ロット` 単位で、前回在庫 - 出庫 + 入庫により再計算します。
- 在庫欄に値を入力した行は手入力フラグを立て、その行を基準点として以降を再計算します。
- 出庫予測は `室名 × 収穫からの経過日数区分` の熟成日数表を参照します。

## 注意点

この初期実装ではGitHub Pagesから直接Supabaseテーブルを操作するため、`anon` に黒にんにく用テーブルの読み書きを許可しています。社内利用や限定URL運用なら扱いやすい構成ですが、外部公開を強く意識する場合は、書き込みをRPCだけに閉じる形へ強化してください。

## GitHub Pagesへの配置

- リポジトリ: [eight-corp/black-garlic-manager](https://github.com/eight-corp/black-garlic-manager)
- 公開URL: [黒にんにく室管理](https://eight-corp.github.io/black-garlic-manager/)
- Pagesの公開元: `main` ブランチの `/` (ルート)

ビルド処理は不要です。画面の更新はこのリポジトリに反映します。Supabaseの接続先とデータは移管前と同じです。

旧URLとはブラウザの保存領域が異なるため、新URLでは初回に作業者の選択やPIN入力が必要になる場合があります。
