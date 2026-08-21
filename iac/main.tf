locals {
  region           = "eu-west-2"
  resources_prefix = "smart-student-planner"
  lambda_runtime   = "nodejs24.x"
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    region = "eu-west-2"
    bucket = "cw2-video-presentation"
    key    = "tf-state/smart-student-planner"
  }
}

provider "aws" {
  region = local.region

  default_tags {}
}

# --- Data Sources ---

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../dist"
  output_path = "${path.module}/../dist.zip"
}

# --- CloudWatch Log Groups ---

resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${local.resources_prefix}-ai-assistant"
  retention_in_days = 60
}

resource "aws_cloudwatch_log_group" "api_gw_logs" {
  name              = "/aws/apigateway/${local.resources_prefix}-api"
  retention_in_days = 60
}

# --- IAM Role for API Gateway CloudWatch Logging ---

resource "aws_iam_role" "api_gw_cloudwatch_role" {
  name = "${local.resources_prefix}-api-gw-cloudwatch-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "apigateway.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "api_gw_cloudwatch" {
  role       = aws_iam_role.api_gw_cloudwatch_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

resource "aws_api_gateway_account" "api_account" {
  cloudwatch_role_arn = aws_iam_role.api_gw_cloudwatch_role.arn

  depends_on = [aws_iam_role_policy_attachment.api_gw_cloudwatch]
}

# --- IAM Role for Lambda ---

resource "aws_iam_role" "lambda_role" {
  name = "${local.resources_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- Lambda Function ---

resource "aws_lambda_function" "ai_assistant" {
  function_name    = "${local.resources_prefix}-ai-assistant"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = local.lambda_runtime
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout          = 120
  memory_size      = 256

  environment {
    variables = {
      OPENROUTER_API_KEY = var.openrouter_api_key
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda_logs]
}

# --- API Gateway REST API ---

resource "aws_api_gateway_rest_api" "api" {
  name        = "${local.resources_prefix}-api"
  description = "Smart Student Planner API"

  # Regional endpoint bypasses the managed CloudFront layer (which has a
  # non-configurable 30s timeout) so the Lambda integration can run up to 2 min.
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# /ssp resource
resource "aws_api_gateway_resource" "ssp" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "ssp"
}

# /ssp/ai-assistant resource
resource "aws_api_gateway_resource" "ai_assistant" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.ssp.id
  path_part   = "ai-assistant"
}

# POST method
resource "aws_api_gateway_method" "post_ai_assistant" {
  rest_api_id      = aws_api_gateway_rest_api.api.id
  resource_id      = aws_api_gateway_resource.ai_assistant.id
  http_method      = "POST"
  authorization    = "NONE"
  api_key_required = true
}

# Lambda integration
resource "aws_api_gateway_integration" "lambda_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.ai_assistant.id
  http_method             = aws_api_gateway_method.post_ai_assistant.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.ai_assistant.invoke_arn
  timeout_milliseconds    = 120000
}

# Lambda permission for API Gateway
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ai_assistant.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# --- API Gateway Deployment & Stage ---

resource "aws_api_gateway_deployment" "api_deployment" {
  rest_api_id = aws_api_gateway_rest_api.api.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.ssp,
      aws_api_gateway_resource.ai_assistant,
      aws_api_gateway_method.post_ai_assistant,
      aws_api_gateway_integration.lambda_integration,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "api_stage" {
  deployment_id = aws_api_gateway_deployment.api_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.api.id
  stage_name    = "v1"

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gw_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      caller         = "$context.identity.caller"
      user           = "$context.identity.user"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      resourcePath   = "$context.resourcePath"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }

  depends_on = [aws_api_gateway_account.api_account]
}

# --- API Key & Usage Plan ---

resource "aws_api_gateway_api_key" "api_key" {
  name    = "${local.resources_prefix}-api-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan" "usage_plan" {
  name = "${local.resources_prefix}-usage-plan"

  api_stages {
    api_id = aws_api_gateway_rest_api.api.id
    stage  = aws_api_gateway_stage.api_stage.stage_name
  }
}

resource "aws_api_gateway_usage_plan_key" "usage_plan_key" {
  key_id        = aws_api_gateway_api_key.api_key.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.usage_plan.id
}
