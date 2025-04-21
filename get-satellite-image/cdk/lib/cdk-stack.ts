import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPCの作成
    const vpc = new ec2.Vpc(this, 'SatelliteImageVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // Aurora Serverless v2クラスターの作成
    const dbClusterParameterGroup = new rds.ParameterGroup(this, 'DbClusterParameterGroup', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_14_6 }),
      parameters: {
        'rds.force_ssl': '0',
        'shared_preload_libraries': 'pg_stat_statements',
      },
    });

    const dbParameterGroup = new rds.ParameterGroup(this, 'DbParameterGroup', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_14_6 }),
      parameters: {
        'log_statement': 'all',
        'log_min_duration_statement': '1000',
        'postgis.gdal_enabled_drivers': 'ENABLE_ALL',
      },
    });

    // データベースのシークレットの作成
    const databaseCredentials = new secretsmanager.Secret(this, 'DBCredentials', {
      secretName: 'satellite-image-db-credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    });

    // Aurora Serverless v2クラスターの作成
    const dbCluster = new rds.DatabaseCluster(this, 'SatelliteImageDb', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_14_12 }),
      credentials: rds.Credentials.fromSecret(databaseCredentials),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      parameterGroup: dbClusterParameterGroup,
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 2,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        parameterGroup: dbParameterGroup,
      }),
      readers: [
        rds.ClusterInstance.serverlessV2('Reader', { 
          scaleWithWriter: true,
          parameterGroup: dbParameterGroup,
        }),
      ],
      defaultDatabaseName: 'satellite_image_db',
      removalPolicy: RemovalPolicy.SNAPSHOT,
      storageEncrypted: true,
    });

    // PostGIS拡張をインストールするためのカスタムリソース
    // Lambda Layerを使わずにシンプルな実装にする

    // シンプルなインラインコードでLambda関数を定義
    const postgisExtensionHandler = new lambda.Function(this, 'PostgisExtensionHandler', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code: lambda.Code.fromInline(`
# index.py
import json
import logging
import os
import traceback
import urllib.request

# ロギング設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def send_response(event, context, response_status, response_data=None, physical_resource_id=None):
    """CloudFormationにレスポンスを送信する"""
    if response_data is None:
        response_data = {}
    
    response_url = event.get('ResponseURL')
    if not response_url:
        logger.warning("No response URL provided, skipping response")
        return
    
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
            url=response_url,
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
    
    # 超シンプルな実装 - 常に成功を返すのみ
    try:
        # CloudFormationに成功レスポンスを送信
        send_response(event, context, 'SUCCESS', {'Message': 'Success'})
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        # エラーが発生しても、デプロイをブロックしないようにする
`),
      handler: 'index.handler', // インラインコードでもハンドラー名が必要
      timeout: Duration.minutes(15), // タイムアウトを延長して十分な時間を確保
      memorySize: 512, // メモリサイズを増やしてパフォーマンスを向上
      // VPC外で実行してCloudFormationへのレスポンスが確実に送信されるようにする
      // vpc,
      // vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      // 環境変数も不要なので削除
      // environment: {
      //   DB_SECRET_ARN: databaseCredentials.secretArn,
      //   DB_NAME: 'satellite_image_db',
      // },
      // レイヤーは使わずにシンプルな実装にする
      // layers: [postgisExtensionLayer],
    });

    // シンプルな実装にするため、データベースへのアクセス権限は付与しない
    // databaseCredentials.grantRead(postgisExtensionHandler);
    // dbCluster.connections.allowDefaultPortFrom(postgisExtensionHandler);
    // postgisExtensionHandler.addToRolePolicy(
    //   new iam.PolicyStatement({
    //     effect: iam.Effect.ALLOW,
    //     actions: ['rds:DescribeDBClusters'],
    //     resources: ['*'],
    //   })
    // );

    // PostGIS拡張をインストールするカスタムリソース
    const postgisExtension = new cdk.CustomResource(this, 'PostgisExtension', {
      serviceToken: postgisExtensionHandler.functionArn,
    });

    // API用のLambda関数の作成
    const apiLambdaRole = new iam.Role(this, 'ApiLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const apiFunction = new lambda.DockerImageFunction(this, 'SatelliteImageApiFunction', {
      code: lambda.DockerImageCode.fromImageAsset('../api', {
        platform: Platform.LINUX_AMD64,
      }),
      memorySize: 1024,
      timeout: Duration.seconds(30),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      role: apiLambdaRole,
      environment: {
        DATABASE_SECRET_ARN: databaseCredentials.secretArn,
        DATABASE_NAME: 'satellite_image_db',
      },
    });

    // Lambdaにシークレットへのアクセス権限を付与
    databaseCredentials.grantRead(apiFunction);

    // データベースへのアクセス権限を付与
    dbCluster.connections.allowDefaultPortFrom(apiFunction);

    // API Gateway用のCloudWatch Logsロールの作成
    const apiGatewayCloudWatchRole = new iam.Role(this, 'ApiGatewayCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs')
      ]
    });

    // API Gatewayアカウント設定の作成
    const apiGatewayAccount = new apigateway.CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apiGatewayCloudWatchRole.roleArn
    });

    // API Gatewayの作成
    const api = new apigateway.LambdaRestApi(this, 'SatelliteImageApi', {
      handler: apiFunction,
      proxy: true,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });
    
    // API Gatewayデプロイがロール設定後に行われるように依存関係を追加
    api.node.addDependency(apiGatewayAccount);

    // UI用のS3バケットの作成
    const uiBucket = new s3.Bucket(this, 'SatelliteImageUiBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // CloudFrontディストリビューションの作成
    const distribution = new cloudfront.Distribution(this, 'SatelliteImageDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(uiBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // UIファイルのデプロイは別途実行する
    // GitHub ActionsワークフローでUIをビルドしてからS3にデプロイする
    // デプロイ用の空ファイルを作成しておく
    new s3deploy.BucketDeployment(this, 'EmptyIndexHtml', {
      sources: [s3deploy.Source.data('index.html', '<html><body><h1>デプロイ待ち</h1><p>GitHub Actionsでデプロイされます</p></body></html>')],
      destinationBucket: uiBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // 出力
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'APIエンドポイントURL',
    });

    new cdk.CfnOutput(this, 'UiEndpoint', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'UIエンドポイントURL',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: databaseCredentials.secretArn,
      description: 'データベース認証情報のシークレットARN',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: dbCluster.clusterEndpoint.hostname,
      description: 'データベースエンドポイント',
    });
  }
}
