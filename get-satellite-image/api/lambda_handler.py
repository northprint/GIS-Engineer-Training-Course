import json
import os
import boto3
import psycopg2
from mangum import Mangum
from app.main import app

# FastAPIアプリケーションをLambdaハンドラーに変換
handler = Mangum(app)

# データベース接続情報を環境変数から取得する関数
def get_db_connection_info():
    """
    AWS Secrets Managerからデータベース接続情報を取得します
    """
    secret_arn = os.environ.get('DATABASE_SECRET_ARN')
    db_name = os.environ.get('DATABASE_NAME', 'satellite_image_db')
    
    if not secret_arn:
        raise ValueError("DATABASE_SECRET_ARN環境変数が設定されていません")
    
    # シークレットマネージャーからシークレットを取得
    secrets_client = boto3.client('secretsmanager')
    secret_response = secrets_client.get_secret_value(SecretId=secret_arn)
    secret = json.loads(secret_response['SecretString'])
    
    # データベース接続情報
    username = secret.get('username')
    password = secret.get('password')
    
    # データベースエンドポイントを取得
    rds_client = boto3.client('rds')
    clusters = rds_client.describe_db_clusters()
    
    # クラスターエンドポイントを検索
    db_cluster_identifier = os.environ.get('DB_CLUSTER_IDENTIFIER')
    endpoint = None
    for cluster in clusters['DBClusters']:
        print(f"Cluster found: {cluster['DBClusterIdentifier']}")
        if cluster['DBClusterIdentifier'] == db_cluster_identifier:
            endpoint = cluster['Endpoint']
            break
    
    if not endpoint:
        raise Exception("データベースクラスターが見つかりませんでした")
    
    return {
        'host': endpoint,
        'database': db_name,
        'user': username,
        'password': password
    }

# アプリケーション起動時にデータベース接続情報を設定
def init_db_connection():
    """
    アプリケーション起動時にデータベース接続情報を環境変数に設定します
    """
    try:
        db_info = get_db_connection_info()
        # 環境変数にデータベースURLを設定
        os.environ['DATABASE_URL'] = f"postgresql://{db_info['user']}:{db_info['password']}@{db_info['host']}:5432/{db_info['database']}"
    except Exception as e:
        print(f"データベース接続情報の取得に失敗しました: {str(e)}")

# Lambda関数のコールドスタート時に実行
init_db_connection()
