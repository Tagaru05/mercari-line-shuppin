# サブPCセットアップ指示書（メルカリ出品ライン・2台目Mac用）

> **これは何か**：メインMacですでに動いている「LINE写真→メルカリ下書き」の仕組みを、サブMacでも動かせるようにするための、Claude Code向けの手順書。
> **設計思想**：真ん中はクラウド（LINEワーカー＋Notion）。PC同士は同期しない。使う側のPCだけ起動する「1台ルール」で衝突を防ぐ。

---

## Claude Codeへ（サブPCのあなた宛て）

あなたはこれから、この持ち主のサブMacに「メルカリ出品ライン」を新規導入します。持ち主は非エンジニアです。

**大原則（絶対に守ること）**：
1. **メインMacからのファイルコピーはしない**（`.env`・Cookie・.jsonl履歴の混入事故を避ける）。設定値は毎回サブPCで「新規に手入力」してもらう
2. **秘密（APIキー・トークン）を持ち主にチャット貼付させない**。1Password等の名前・参照だけ扱う（[[ref-1password-cli]]の型に従う）
3. **メインMacの運用は絶対に触らない**。サブPC単独で完結させる
4. 各STEPが終わるごとに「実物確認」（ls・cat・curl等）で通ったか自分の目で見てから次へ

**運用ルール（持ち主に最初に伝える）**：
👉 **LINE受付のMonitor監視は、その時使うPCだけで起動する**。両方同時に起動すると同じ写真を2台が拾って重複下書きが出る。使わない方は`Ctrl+C`で監視だけ止めればOK（フォルダは残しておく）。

---

## 全体の流れ

```
STEP 1  持ち物チェック（10分・持ち主にヒアリング）
STEP 2  Claude Code＋開発道具の導入確認（15分）
STEP 3  GitHubから本体を取得（5分）
STEP 4  スキル（~/.claude/skills/）を導入（10分）
STEP 5  APIキー・鍵の新規登録（15分・持ち主が手入力）
STEP 6  Chrome拡張とログインを新規セットアップ（15分）
STEP 7  疎通テスト（写真1枚で最後まで通す）（15分）
```

**所要**：約90分。休憩OK、途中でやめて後日再開OK。

---

## STEP 1. 持ち物チェック（持ち主に聞く）

- [ ] Mac（サブPC側・OSは最新推奨）
- [ ] Claude Code（課金プラン）はインストール済みか？
- [ ] 1PasswordのデスクトップアプリはこのサブPCにも入っているか？（Personal金庫にログイン済みか）
- [ ] メインMacで現在Monitor監視は動いているか？→動いていたら**メインで一度Ctrl+Cで止めてもらう**（今夜のテスト中の重複防止）

もし1つでも欠けていたら、その旨を持ち主に伝えて先に整えてもらう。

---

## STEP 2. 開発道具の導入確認

以下を1つずつ持ち主のターミナルで実行し、バージョンが出るか確認：

```bash
python3 --version       # 3.10以上が望ましい
git --version
brew --version          # なければ https://brew.sh からインストール案内
```

無ければ導入手順を提示（Homebrew→python3→gitの順）。**ここでpip install は絶対にしない**（後で必要になったら venv 方式で入れる）。

---

## STEP 3. GitHubから本体を取得

サブPCの `~/Desktop/総合フォルダー/` を新規作成し、その中に本体をクローン：

```bash
mkdir -p ~/Desktop/総合フォルダー
cd ~/Desktop/総合フォルダー
git clone https://github.com/Tagaru05/mercari-line-shuppin.git
cd mercari-line-shuppin
ls
```

`はじめにお読みください.md` `セットアップ指示書.md` `worker/` などが並んでいれば成功。**このMacのファイルはこれが正**として扱う。

---

## STEP 4. スキルの導入

`~/.claude/skills/` にメルカリ関連スキル2本を入れる。方法は2択：

### 方法A（推奨）：メインMacの持ち主にGitHubへpushしてもらってからclone
持ち主に「メインMacで `~/.claude/skills/mercari-shuppin/` と `mercari-remote/` をGitHubのprivateリポにしてもらう」よう伝える。ただしこれは1回きりの作業なので、時間があるとき用の中長期案。

### 方法B（今夜すぐ動かす用）：持ち主に手動で作ってもらう
持ち主のメインMacから、SKILL.md **本文だけを** テキストとしてコピー→サブPCで貼り付け。手順：

1. サブPCで `mkdir -p ~/.claude/skills/mercari-shuppin ~/.claude/skills/mercari-remote`
2. 持ち主にメインMacの以下を開いてもらい、本文をコピペしてもらう：
   - `~/.claude/skills/mercari-shuppin/SKILL.md`
   - `~/.claude/skills/mercari-remote/SKILL.md`
3. サブPCで同じ場所に貼り付け保存
4. `ls ~/.claude/skills/mercari-shuppin ~/.claude/skills/mercari-remote` で確認

⚠️ SKILL.mdの中に鍵は入っていない（今夜時点で確認済み）。安心して貼っていい。

---

## STEP 5. APIキー・鍵の新規登録（最重要・非コピー原則）

**メインMacからコピーしない。1Passwordから読み込むか、持ち主に手で入れてもらう**（.jsonl履歴混入事故を防ぐ）。

必要な鍵の一覧を持ち主に見せて、1つずつ確認：

| 鍵 | 用途 | 取得方法 |
|---|---|---|
| Notion Integration Token | メルカリ下書き記録用 | 1Password Personal金庫の「Notion Integration」項目 or notion.so/my-integrations から新規発行 |
| LINE Worker用の認証キー（.list_key） | LINE受付Workerと通信 | メインMacの `line-mercari-uketsuke/.list_key` の値を、持ち主に **1Passwordの新規項目「LINE Worker Key」に手入力**してもらってから、サブPCでopで読み出す |
| GPTs指示文 | 商品風画像生成用 | 秘密ではない（`GPTs指示文.md` に既に平文で入っている） |

**1Password運用の型**（[[ref-1password-cli]]）：
- `.env` ファイルは作らない。代わりに `.env.op` を作り、参照だけ書く：
  ```
  NOTION_TOKEN=op://Personal/Notion Integration/credential
  LINE_WORKER_KEY=op://Personal/LINE Worker Key/credential
  ```
- 起動時は `op run --env-file=.env.op -- <コマンド>` で注入
- **これらの値をチャットに出させない**（.jsonl焼付事故防止）

---

## STEP 6. Chrome拡張とログイン（新規セットアップ・Cookieコピー禁止）

1. サブPCのChromeを起動（未インストールなら Google Chrome を新規導入）
2. **メインMacのChromeプロファイルを移行しない**（履歴・Cookie全部移行は事故のもと）
3. 以下を各サイトで **サブPCから新規ログイン**：
   - メルカリ（同じアカウント）
   - Notion
   - ChatGPT（GPTs使用のためログイン）
4. Claude in Chrome拡張を新規インストール：
   - Chromeウェブストアで「Claude for Chrome」を検索してインストール
   - サブPCのClaudeアカウントでサインイン
5. 拡張が動作することを持ち主に確認してもらう（拡張アイコンクリック→パネル表示）

**なぜCookieをコピーしないか**：セッションCookieを持ち歩くとセキュリティ的にリスク大。各PCで新規ログインが安全＆確実。

---

## STEP 7. 疎通テスト（実物確認）

持ち主に「LINEで自分あてに写真を1枚送ってもらう」（食品・医薬品でないもの、身の回りの小物など）。

サブPCで受付Monitor起動：
```bash
cd ~/Desktop/総合フォルダー/mercari-line-shuppin
# ここで運用手順.md STEP1のMonitor起動コマンドを参照して実行
```

以下を実物確認：
- [ ] 写真が受付箱に届いた（Notion or Worker側の記録）
- [ ] 白抜き画像が生成された（PNG実物確認）
- [ ] GPTs商品風が生成された（見て違和感なし）
- [ ] メルカリ下書きにタイトル・説明・写真3枚が入った（Chrome画面で確認）
- [ ] 「出品ボタン」を押していないことを確認（人間の仕事は残っている）

うまくいったら持ち主に「テスト下書きは削除してOK」と伝える。

---

## 完了報告テンプレ（Claude Codeが持ち主に伝える）

```
サブPC側の導入が完了しました。実物確認済み：
✅ 本体フォルダ：~/Desktop/総合フォルダー/mercari-line-shuppin/
✅ スキル2本：~/.claude/skills/mercari-shuppin, mercari-remote
✅ 1Password連携：.env.op で参照方式
✅ Chrome＋拡張：新規ログイン済み
✅ 疎通テスト：写真1枚→下書き作成まで通過

【運用ルール（大事）】
LINE監視Monitorは、その時使うPCだけで起動してください。
両方同時起動＝重複下書きの原因。使い終わったらCtrl+Cで止めるだけ。
```

---

## トラブル時の合言葉

- 「Monitorが動かない」→ `.env.op`のパス指定・op runコマンド確認
- 「メルカリ画面が触れない」→ Claude in Chrome拡張のサインイン再確認
- 「写真が拾えない」→ LINE Worker側の疎通（`.list_key`一致確認）
- 何が起きているかわからない → 持ち主に「一旦Ctrl+Cで止めて」と伝え、状況を1行でメモしてもらう

---

*作成：2026-07-20 ウィザーモン。真ん中クラウド・両側は使い捨ての手足、の設計。*
