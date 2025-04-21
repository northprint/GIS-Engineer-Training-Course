# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import logging
import urllib.request

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def send(event, context, response_status, response_data, physical_resource_id=None, no_echo=False):
    """
    CloudFormationにレスポンスを送信する関数
    
    Args:
        event: CloudFormationからのイベント
        context: Lambda実行コンテキスト
        response_status: 'SUCCESS'または'FAILED'
        response_data: レスポンスに含めるデータ
        physical_resource_id: 物理リソースID
        no_echo: レスポンスをCloudFormationコンソールに表示しない場合はTrue
    """
    response_url = event['ResponseURL']
    
    logger.info(f"CFN response URL: {response_url}")
    
    response_body = {
        'Status': response_status,
        'Reason': f"See the details in CloudWatch Log Stream: {context.log_stream_name}",
        'PhysicalResourceId': physical_resource_id or context.log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'NoEcho': no_echo,
        'Data': response_data
    }
    
    json_response_body = json.dumps(response_body)
    
    headers = {
        'Content-Type': '',
        'Content-Length': str(len(json_response_body))
    }
    
    try:
        req = urllib.request.Request(
            url=response_url,
            data=json_response_body.encode('utf-8'),
            headers=headers,
            method='PUT'
        )
        
        with urllib.request.urlopen(req) as response:
            logger.info(f"Status code: {response.getcode()}")
            logger.info(f"Response: {response.read().decode('utf-8')}")
    except Exception as e:
        logger.error(f"Error sending CFN response: {str(e)}")
        raise
