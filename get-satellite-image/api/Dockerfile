FROM public.ecr.aws/lambda/python:3.10

# システムパッケージのインストール
RUN yum update -y && \
    yum install -y gcc gcc-c++ make wget tar gzip && \
    yum clean all

# 必要なPythonパッケージのインストール
RUN pip install --no-cache-dir \
    fastapi \
    mangum \
    uvicorn \
    psycopg2-binary \
    httpx \
    boto3 \
    aws-lambda-powertools \
    numpy \
    pillow \
    rio-tiler

# アプリケーションコードのコピー
COPY ./app ${LAMBDA_TASK_ROOT}/app

# Lambdaハンドラーコードのコピー
COPY ./lambda_handler.py ${LAMBDA_TASK_ROOT}

# 環境変数の設定
ENV PYTHONPATH=${LAMBDA_TASK_ROOT}

# Lambdaハンドラーを呼び出す
CMD [ "lambda_handler.handler" ]