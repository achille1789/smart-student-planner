output "api_gateway_url" {
  description = "The invoke URL of the API Gateway"
  value       = "${aws_api_gateway_stage.api_stage.invoke_url}/ssp/ai-assistant"
}

output "api_key_value" {
  description = "The API key value for accessing the endpoint"
  value       = aws_api_gateway_api_key.api_key.value
  sensitive   = true
}

output "lambda_function_name" {
  description = "The name of the Lambda function"
  value       = aws_lambda_function.ai_assistant.function_name
}

