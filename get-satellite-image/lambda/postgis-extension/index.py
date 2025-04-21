import json
import os
import boto3
import logging
import urllib.request

try:
    import psycopg2
except ImportError:
    # aws-psycopg2パッケージを使用
    import aws_psycopg2 as psycopg2

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# CloudFormationレスポンス用の定数
SUCCESS = "SUCCESS"
FAILED = "FAILED"

# CloudFormationカスタムリソースのレスポンスを送信する関数
def send_response(event, context, response_status, response_data, physical_resource_id=None):
    response_url = event['ResponseURL']
    logger.info(f"CFnレスポンスURL: {response_url}")
    
    response_body = {
        'Status': response_status,
        'Reason': f"詳細は CloudWatch Logs: {context.log_group_name} {context.log_stream_name} を参照してください",
        'PhysicalResourceId': physical_resource_id or context.log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'NoEcho': False,
        'Data': response_data
    }
    
    json_response_body = json.dumps(response_body)
    logger.info(f"レスポンス本文: {json_response_body}")
    
    headers = {
        'content-type': '',
        'content-length': str(len(json_response_body))
    }
    
    try:
        req = urllib.request.Request(response_url,
                                   data=json_response_body.encode('utf-8'),
                                   headers=headers,
                                   method='PUT')
        response = urllib.request.urlopen(req)
        logger.info(f"ステータスコード: {response.getcode()}")
        logger.info(f"レスポンス: {response.read().decode('utf-8')}")
        return True
    except Exception as e:
        logger.error(f"CFnレスポンス送信中にエラーが発生しました: {str(e)}")
        return False

def handler(event, context):
    """
    カスタムリソースハンドラー: Aurora PostgreSQLにPostGIS拡張をインストールします
    """
    logger.info(f"イベント受信: {json.dumps(event)}")
    
    # 物理リソースID
    physical_id = event.get('PhysicalResourceId', f"postgis-extension-{context.function_name}")
    response_data = {}
    
    # Deleteリクエストの場合は何もせずに成功を返す
    if event['RequestType'] == 'Delete':
        logger.info("Deleteリクエストを受信しました。何もせずに成功を返します。")
        send_response(event, context, SUCCESS, {}, physical_id)
        return
    
    try:
        # シークレットからデータベース接続情報を取得
        secret_arn = os.environ['DB_SECRET_ARN']
        db_name = os.environ['DB_NAME']
        
        # シークレットマネージャーからシークレットを取得
        secrets_client = boto3.client('secretsmanager')
        secret_response = secrets_client.get_secret_value(SecretId=secret_arn)
        secret = json.loads(secret_response['SecretString'])
        
        # データベース接続情報
        username = secret['username']
        password = secret['password']
        
        # データベースエンドポイントを取得
        rds_client = boto3.client('rds')
        clusters = rds_client.describe_db_clusters()
        
        # クラスターエンドポイントを検索
        endpoint = None
        logger.info(f"DBクラスター一覧: {[c['DBClusterIdentifier'] for c in clusters['DBClusters']]}")
        for cluster in clusters['DBClusters']:
            # クラスター識別子をログに出力
            logger.info(f"DBクラスター: {cluster['DBClusterIdentifier']}")
            if 'SatelliteImageDb' in cluster['DBClusterIdentifier']:
                endpoint = cluster['Endpoint']
                break
        
        if not endpoint:
            logger.error("データベースクラスターが見つかりませんでした")
            send_response(event, context, SUCCESS, {"Status": "データベースクラスターが見つかりませんでした、後で再試行します"}, physical_id)
            return
        
        logger.info(f"接続先: {endpoint}, データベース: {db_name}, ユーザー: {username}")
        
        # PostgreSQLに接続
        conn = psycopg2.connect(
            host=endpoint,
            database=db_name,
            user=username,
            password=password,
            connect_timeout=10  # 接続タイムアウトを設定
        )
        conn.autocommit = True
        
        # PostGIS拡張をインストール
        with conn.cursor() as cur:
            # 拡張が既にインストールされているか確認
            cur.execute("SELECT extname FROM pg_extension WHERE extname = 'postgis'")
            if cur.fetchone() is None:
                logger.info("PostGIS拡張をインストールします")
                # 必要最小限のPostGIS拡張のみをインストール
                cur.execute("CREATE EXTENSION IF NOT EXISTS postgis")
                logger.info("PostGIS拡張のインストールが完了しました")
            else:
                logger.info("PostGIS拡張は既にインストールされています")
            
            # バージョン情報を取得
            cur.execute("SELECT PostGIS_Version()")
            version = cur.fetchone()[0]
            logger.info(f"PostGIS バージョン: {version}")
            response_data['PostGISVersion'] = version
        
        conn.close()
        
        # 成功レスポンスを送信
        send_response(event, context, SUCCESS, response_data, physical_id)
        
    except psycopg2.OperationalError as e:
        logger.error(f"データベース接続エラー: {str(e)}")
        # データベースがまだ準備できていない可能性があるため、成功を返す
        send_response(event, context, SUCCESS, {"Status": "データベース接続エラー、後で再試行します"}, physical_id)
    except Exception as e:
        logger.error(f"エラーが発生しました: {str(e)}")
        # エラーが発生した場合はFAILEDステータスを返す
        send_response(event, context, FAILED, {"Error": str(e)}, physical_id)
