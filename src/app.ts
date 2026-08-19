import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

export const handler = async (event: APIGatewayProxyEvent) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');

  // Extract the assistant message with reasoning_details and save it to the response variable
  let resp = await _getAI();
  const result = await resp.json();
  resp = result.choices[0].message;

  console.log('Assistant message with reasoning_details:', JSON.stringify(resp, null, 2));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event.body),
  };
};

// First API call with reasoning
const _getAI = async () => fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    "model": "google/gemma-4-26b-a4b-it:free",
    "messages": [
      {
        "role": "user",
        "content": "How many r's are in the word 'strawberry'?"
      }
    ],
    "reasoning": {"enabled": true}
  })
});

// Extract the assistant message with reasoning_details and save it to the response variable
// const result = await response.json();
// response = result.choices[0].message;

// Preserve the assistant message with reasoning_details
// const messages = [
//   {
//     role: 'user',
//     content: "How many r's are in the word 'strawberry'?",
//   },
//   {
//     role: 'assistant',
//     content: response.content,
//     reasoning_details: response.reasoning_details, // Pass back unmodified
//   },
//   {
//     role: 'user',
//     content: "Are you sure? Think carefully.",
//   },
// ];
//
// // Second API call - model continues reasoning from where it left off
// const response2 = await fetch("https://openrouter.ai/api/v1/chat/completions", {
//   method: "POST",
//   headers: {
//     "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
//     "Content-Type": "application/json",
//   },
//   body: JSON.stringify({
//     "model": "google/gemma-4-26b-a4b-it:free",
//     "messages": messages  // Includes preserved reasoning_details
//   })
// });