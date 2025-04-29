# get-satellite-image

衛星画像を検索＆表示できる Web アプリです
AWS（CDK, Lambda, RDS/PostGIS）、FastAPI、MapLibre GL、Vite+TypeScript で構成されています

## ディレクトリ構成

```
get-satellite-image/
├── api/                # Python FastAPIサーバ(API)
├── cdk/                # AWS CDK IaC（インフラ管理）
├── lambda/             # Lambda関数（主にDB拡張用）
├── postgis-init/       # PostGIS初期化SQL
├── ui/                 # フロントエンド（Vite+TypeScript+MapLibre GL）
├── docker-compose.yml  # ローカル開発用
```

## セットアップ手順

### 1. 依存関係インストール

- バックエンド(API):
  ```
  cd api
  pip install -r requirements.txt
  ```
- フロントエンド(UI):

  ```
  cd ui
  npm install
  ```

- CDK（インフラ）:
  ```
  cd cdk
  pnpm install
  ```

### 2. ローカル起動

- API サーバー:
  ```
  cd api
  uvicorn app.main:app --reload
  ```
- UI:
  ```
  cd ui
  npm run dev
  ```
- DB(PostGIS)など:
  ```
  docker-compose up
  ```

### 3. デプロイ（AWS）

```
cd cdk
pnpm deploy
```

## 使い方

1. ブラウザで UI にアクセスして、地図上で衛星画像を検索・表示できるで！
2. API は FastAPI
3. AWS 環境では CDK で構築

## 開発 Tips

- UI は Vite+TypeScript+MapLibre GL
- API は FastAPI で、DB は PostGIS
- Lambda や CDK のコードも全部このリポジトリで管理
- CI/CD 完備
