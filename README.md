# Spotify ReBlend

友達と一緒に、お互いのトップ曲をブレンドした共有プレイリストを作成するWebアプリケーションです。

## 機能

- 🎵 **Spotifyログイン** - Spotifyアカウントで簡単ログイン
- 👥 **友達を招待** - プレイリストに友達を招待
- 🔀 **トップ曲をブレンド** - 各メンバーの過去1ヶ月のトップ曲を自動でシャッフル
- 💚 **Spotifyに保存** - 作成したプレイリストは全メンバーのSpotifyに自動保存

## アーキテクチャ

```
spotify-reblend/
├── Dockerfile              # 統合イメージ
├── docker-compose.yml      # サービス構成
├── package.json            # ワークスペース設定
└── packages/
    ├── backend/            # Express API (フロントエンドも配信)
    └── frontend/           # React SPA
```

単一のDockerイメージでフロントエンドとバックエンドの両方を提供します。
バックエンドがビルドされたフロントエンドの静的ファイルを配信する構造です。

## 必要な環境

- Docker
- Docker Compose
- Spotify Developer アカウント

## セットアップ

### 1. Spotify Developer Dashboard でアプリを作成

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) にアクセス
2. 「Create app」をクリック
3. アプリ名と説明を入力
4. **Redirect URI** に `http://localhost:3000/callback` を追加
5. 「Web API」にチェックを入れる
6. 利用規約に同意して作成

### 2. 環境変数を設定

```bash
# .config/.env.example を .config/.env にコピー
cp .config/.env.example .config/.env

# .config/postgres.env.example を .config/postgres.env にコピー
cp .config/postgres.env.example .config/postgres.env
```

`.config/.env` ファイルなどを必要に応じて編集してください。
`.config/postgres.env` はデフォルトのままでも動作しますが、セキュリティ上、本番環境ではパスワードの変更を推奨します。

```
SPOTIFY_CLIENT_ID=あなたのClient ID
SPOTIFY_CLIENT_SECRET=あなたのClient Secret
```

### 3. アプリケーションを起動

```bash
docker-compose up -d
```

### 4. ブラウザでアクセス

http://localhost:3000 にアクセスしてください。

## 使い方

1. **ログイン** - 「Spotifyでログイン」ボタンをクリック
2. **プレイリスト作成** - ダッシュボードで「新規作成」をクリック
3. **友達を招待** - プレイリスト詳細画面でユーザーを検索して招待
4. **招待を承諾** - 招待された友達がログインして招待を承諾
5. **プレイリスト生成** - 全員が参加したら「プレイリストを生成」をクリック
6. **Spotifyで再生** - 生成されたプレイリストはSpotifyアプリで再生可能

## 技術スタック

| コンポーネント | 技術 |
|---------------|------|
| フロントエンド | React + Vite + TypeScript |
| バックエンド | Node.js + Express + TypeScript |
| データベース | PostgreSQL |
| コンテナ | Docker + Docker Compose |
| パッケージ管理 | pnpm |

## 開発

### ローカル開発

```bash
# 依存関係をインストール
pnpm install

# バックエンド開発サーバー
pnpm dev:backend

# フロントエンド開発サーバー（別ターミナル）
pnpm dev:frontend
```

### ビルド

```bash
# フロントエンドとバックエンドをビルド
pnpm build
```

### Docker コマンド

```bash
# ビルドして起動
docker-compose up -d --build

# ログ確認
docker-compose logs -f

# 停止
docker-compose down

# データベースも含めて完全にリセット
docker-compose down -v
```

## ライセンス

MIT
