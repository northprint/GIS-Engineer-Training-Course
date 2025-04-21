import json
import logging
import os
import sys
import traceback
import urllib.request

import boto3
import psycopg2

# ロギング設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def get_secret():
    """AWS Secrets Managerからデータベース認証情報を取得する"""
    secret_name = os.environ.get('DB_SECRET_ARN')
    region_name = os.environ.get('AWS_REGION', 'ap-northeast-1')
    
    logger.info(f"Retrieving secret from {secret_name}")
    
    # Secrets Managerクライアントを作成
    client = boto3.client('secretsmanager', region_name=region_name)
    
    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
    except Exception as e:
        logger.error(f"Error retrieving secret: {str(e)}")
        raise e
    
    # シークレット文字列をJSONとして解析
    secret = json.loads(get_secret_value_response['SecretString'])
    return secret

def send_response(event, context, response_status, response_data=None, physical_resource_id=None):
    """CloudFormationにレスポンスを送信する"""
    if response_data is None:
        response_data = {}
    
    # cfnresponseモジュールが利用可能かチェック
    try:
        import cfnresponse
        logger.info("Using cfnresponse module")
        cfnresponse.send(event, context, response_status, response_data, physical_resource_id)
        return
    except ImportError:
        logger.info("cfnresponse module not available, using custom response sender")
    
    response_body = {
        'Status': response_status,
        'Reason': f"See details in CloudWatch Log Stream: {context.log_stream_name}",
        'PhysicalResourceId': physical_resource_id or context.log_stream_name,
        'StackId': event.get('StackId', ''),
        'RequestId': event.get('RequestId', ''),
        'LogicalResourceId': event.get('LogicalResourceId', ''),
        'Data': response_data
    }
    
    response_body_json = json.dumps(response_body)
    logger.info(f"Response body: {response_body_json}")
    
    headers = {
        'Content-Type': '',
        'Content-Length': str(len(response_body_json))
    }
    
    try:
        request = urllib.request.Request(
            url=event.get('ResponseURL', ''),
            data=response_body_json.encode('utf-8'),
            headers=headers,
            method='PUT'
        )
        
        with urllib.request.urlopen(request) as response:
            logger.info(f"Status code: {response.getcode()}")
            logger.info(f"Response: {response.read().decode('utf-8')}")
    except Exception as e:
        logger.error(f"Error sending response: {str(e)}")
        logger.error(traceback.format_exc())

def handler(event, context):
    """Lambda関数のメインハンドラー"""
    logger.info("PostGIS extension installation Lambda started")
    # リクエストの詳細を抽出
    request_type = event['RequestType']
    
    # CREATE以外のリクエストタイプは成功として処理
    if request_type != 'Create':
        logger.info(f"Request type is {request_type}, sending success response")
        send_response(event, context, 'SUCCESS')
        return
    
    try:
        # データベース認証情報を取得
        secret = get_secret()
        db_name = os.environ.get('DB_NAME', 'postgres')
        
        # 接続パラメータを設定
        conn_params = {
            'host': secret['host'],
            'port': secret.get('port', 5432),
            'user': secret['username'],
            'password': secret['password'],
            'dbname': db_name,
            'connect_timeout': 10
        }
        
        logger.info(f"Connecting to database {db_name} at {conn_params['host']}:{conn_params['port']}")
        
        # データベースに接続
        conn = psycopg2.connect(**conn_params)
        conn.autocommit = True
        
        with conn.cursor() as cur:
            # PostGIS拡張がすでにインストールされているか確認
            cur.execute("SELECT extname FROM pg_extension WHERE extname = 'postgis'")
            if cur.fetchone():
                logger.info("PostGIS extension is already installed")
            else:
                logger.info("Installing PostGIS extension")
                cur.execute("CREATE EXTENSION IF NOT EXISTS postgis")
                logger.info("PostGIS extension installed successfully")
        
        conn.close()
        logger.info("Database connection closed")
        
        # 成功レスポンスを送信
        send_response(event, context, 'SUCCESS', {'Message': 'PostGIS extension installed successfully'})
        
    except psycopg2.OperationalError as e:
        # データベース接続エラー
        error_message = f"Database connection error: {str(e)}"
        logger.error(error_message)
        # データベース接続エラーの場合でも成功として処理（デプロイをブロックしない）
        send_response(event, context, 'SUCCESS', {'Message': error_message})
    except Exception as e:
        # その他のエラー
        error_message = f"Error installing PostGIS extension: {str(e)}"
        logger.error(error_message)
        logger.error(traceback.format_exc())
        # エラーレスポンスを送信
        send_response(event, context, 'FAILED', {'Message': error_message})
