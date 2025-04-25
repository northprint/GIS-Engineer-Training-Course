import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cr from "aws-cdk-lib/custom-resources";
import { RemovalPolicy, Duration } from "aws-cdk-lib";

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPCの作成
    const vpc = new ec2.Vpc(this, "SatelliteImageVpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    // データベースのシークレットの作成
    const databaseCredentials = new secretsmanager.Secret(
      this,
      "DBCredentials",
      {
        secretName: "satellite-image-db-credentials",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: "postgres" }),
          generateStringKey: "password",
          excludePunctuation: true,
        },
      }
    );

    // Aurora Serverless v2クラスターの作成
    const dbClusterParameterGroup = new rds.ParameterGroup(
      this,
      "DbClusterParameterGroup",
      {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_14_6,
        }),
        parameters: {
          "rds.force_ssl": "0",
          shared_preload_libraries: "pg_stat_statements",
        },
      }
    );

    const dbParameterGroup = new rds.ParameterGroup(this, "DbParameterGroup", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_14_6,
      }),
      parameters: {
        log_statement: "all",
        log_min_duration_statement: "1000",
        "postgis.gdal_enabled_drivers": "ENABLE_ALL",
      },
    });

    // Aurora Serverless v2クラスターの作成
    const dbCluster = new rds.DatabaseCluster(this, "SatelliteImageDb", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_14_12,
      }),
      credentials: rds.Credentials.fromSecret(databaseCredentials),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      parameterGroup: dbClusterParameterGroup,
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 2,
      writer: rds.ClusterInstance.serverlessV2("Writer", {
        parameterGroup: dbParameterGroup,
      }),
      readers: [
        rds.ClusterInstance.serverlessV2("Reader", {
          scaleWithWriter: true,
          parameterGroup: dbParameterGroup,
        }),
      ],
      defaultDatabaseName: "satellite_image_db",
      removalPolicy: RemovalPolicy.SNAPSHOT,
      storageEncrypted: true,
    });

    // Lambda 関数が DB にアクセスするためのセキュリティグループ
    const lambdaSG = new ec2.SecurityGroup(this, "LambdaSG", {
      vpc: dbCluster.vpc,
    });
    // DB クラスターのセキュリティグループに Lambda からのアクセスを許可
    dbCluster.connections.allowFrom(
      lambdaSG,
      ec2.Port.tcp(dbCluster.clusterEndpoint.port)
    );

    // PostGIS拡張をインストールするためのカスタムリソース

    const postgisExtensionHandler = new lambda.Function(
      this,
      "PostgisExtensionHandler",
      {
        runtime: lambda.Runtime.PYTHON_3_9,
        code: lambda.Code.fromAsset("../lambda/postgis-extension", {
          bundling: {
            image: lambda.Runtime.PYTHON_3_9.bundlingImage,
            command: [
              "bash",
              "-c",
              [
                "pip install -r requirements.txt -t /asset-output",
                "cp -au . /asset-output",
              ].join(" && "),
            ],
          },
        }),
        handler: "index.handler",
        timeout: Duration.minutes(15), // タイムアウトを延長して十分な時間を確保
        memorySize: 1024, // メモリサイズを増やしてパフォーマンスを向上
        vpc: dbCluster.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [lambdaSG],
        environment: {
          DB_SECRET_ARN: databaseCredentials.secretArn,
          DB_NAME: "satellite_image_db",
          DB_CLUSTER_ENDPOINT: dbCluster.clusterEndpoint.hostname,
          DB_PORT: dbCluster.clusterEndpoint.port.toString(),
          DB_CLUSTER_IDENTIFIER: dbCluster.clusterIdentifier,
          DUMMY_TRIGGER: new Date().toISOString(),
        },
      }
    );

    // Lambda に Secrets Manager への読み取り権限を付与
    databaseCredentials.grantRead(postgisExtensionHandler);

    //dbCluster.connections.allowDefaultPortFrom(postgisExtensionHandler);
    postgisExtensionHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["rds:DescribeDBClusters"],
        resources: ["*"],
      })
    );

    // カスタムリソースで Lambda 関数をトリガー
    const dbSetupProvider = new cr.Provider(this, "DbSetupProvider", {
      onEventHandler: postgisExtensionHandler,
    });

    // PostGIS拡張をインストールするカスタムリソース
    const postgisExtension = new cdk.CustomResource(this, "PostgisExtension", {
      serviceToken: dbSetupProvider.serviceToken,
      properties: {
        DbClusterIdentifier: dbCluster.clusterIdentifier,
      },
    });

    postgisExtensionHandler.node.addDependency(dbCluster);

    // API用のLambda関数の作成
    const apiLambdaRole = new iam.Role(this, "ApiLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaVPCAccessExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    const apiFunction = new lambda.DockerImageFunction(
      this,
      "SatelliteImageApiFunction",
      {
        code: lambda.DockerImageCode.fromImageAsset("../api", {
          platform: Platform.LINUX_AMD64,
        }),
        memorySize: 1024,
        timeout: Duration.seconds(30),
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        role: apiLambdaRole,
        environment: {
          DATABASE_SECRET_ARN: databaseCredentials.secretArn,
          DATABASE_NAME: "satellite_image_db",
          DB_CLUSTER_IDENTIFIER: dbCluster.clusterIdentifier,
        },
      }
    );

    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["rds:DescribeDBClusters"],
        resources: ["*"],
      })
    );

    // Lambdaにシークレットへのアクセス権限を付与
    databaseCredentials.grantRead(apiFunction);

    // データベースへのアクセス権限を付与
    dbCluster.connections.allowDefaultPortFrom(apiFunction);

    // API Gateway用のCloudWatch Logsロールの作成
    const apiGatewayCloudWatchRole = new iam.Role(
      this,
      "ApiGatewayCloudWatchRole",
      {
        assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonAPIGatewayPushToCloudWatchLogs"
          ),
        ],
      }
    );

    // API Gatewayアカウント設定の作成
    const apiGatewayAccount = new apigateway.CfnAccount(
      this,
      "ApiGatewayAccount",
      {
        cloudWatchRoleArn: apiGatewayCloudWatchRole.roleArn,
      }
    );

    // API Gatewayの作成
    const api = new apigateway.LambdaRestApi(this, "SatelliteImageApi", {
      handler: apiFunction,
      proxy: true,
      binaryMediaTypes: ["image/jpeg"],
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName: "prod",
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });

    // API Gatewayデプロイがロール設定後に行われるように依存関係を追加
    api.node.addDependency(apiGatewayAccount);

    // UI用のS3バケットの作成
    const uiBucket = new s3.Bucket(this, "SatelliteImageUiBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // CloudFrontディストリビューションの作成
    const distribution = new cloudfront.Distribution(
      this,
      "SatelliteImageDistribution",
      {
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(uiBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        additionalBehaviors: {
          "/api/*": {
            origin: new origins.RestApiOrigin(api),
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            originRequestPolicy:
              cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          },
        },
        defaultRootObject: "index.html",
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
        ],
      }
    );

    // UIファイルのデプロイは別途実行する
    // GitHub ActionsワークフローでUIをビルドしてからS3にデプロイする
    // デプロイ用の空ファイルを作成しておく
    new s3deploy.BucketDeployment(this, "EmptyIndexHtml", {
      sources: [
        s3deploy.Source.data(
          "index.html",
          "<html><body><h1>デプロイ待ち</h1><p>GitHub Actionsでデプロイされます</p></body></html>"
        ),
      ],
      destinationBucket: uiBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // 出力
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: api.url,
      description: "APIエンドポイントURL",
    });

    new cdk.CfnOutput(this, "UiEndpoint", {
      value: `https://${distribution.distributionDomainName}`,
      description: "UIエンドポイントURL",
    });

    new cdk.CfnOutput(this, "DatabaseSecretArn", {
      value: databaseCredentials.secretArn,
      description: "データベース認証情報のシークレットARN",
    });

    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: dbCluster.clusterEndpoint.hostname,
      description: "データベースエンドポイント",
    });
  }
}
