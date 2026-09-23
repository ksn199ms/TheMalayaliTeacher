# 🤖 TheMalayaliTeacher — Gemini Integration & Quota Management

TheMalayaliTeacher is built exclusively on Google Gemini (`gemini-3.8-flash` and `gemini-embedding-001`).

---

## 1. Centralized Gemini Client

All Gemini calls route through `GeminiService`:
- **Model Selection**: Defaults to `gemini-3.8-flash` for high throughput, fast response times, and superior context comprehension.
- **Embeddings**: `gemini-embedding-001` producing 768-dimensional normalized vectors.

---

## 2. Quota & Rate Limit Protection

To handle API rate limits and free-tier quotas reliably:
1. **Exponential Backoff with Jitter**:
   - Initial retry delay: 1000ms
   - Max retry delay: 30000ms
   - Jitter: 500ms
   - Retries: Up to 3 attempts on HTTP 429 / RESOURCE_EXHAUSTED
2. **Concurrency Control**:
   - Queue-based concurrency limiter ensures maximum concurrent calls do not saturate API rate limits.
3. **Response Caching**:
   - Frequently asked queries and identical prompts are cached in-memory with configurable TTL to reduce API usage.
4. **Token Budget Enforcement**:
   - Maximum context chunks for study modes (summaries: 20, quizzes: 15, explain: 8) ensure generation costs remain optimal.
