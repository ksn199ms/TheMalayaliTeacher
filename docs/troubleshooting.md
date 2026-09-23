# 🔧 TheMalayaliTeacher — Troubleshooting Guide

Common issues and remediation steps when running or deploying **TheMalayaliTeacher**.

---

## 1. Document Upload & Processing Issues

### Error: `File type not supported`
- **Cause**: The uploaded file MIME type or magic bytes do not match PDF, DOCX, TXT, or Markdown.
- **Fix**: Verify file integrity and ensure the extension matches `.pdf`, `.docx`, `.txt`, or `.md`. Images (`.jpg`, `.jpeg`, `.png`, `.webp`) are processed via Gemini OCR.

### Document stuck in `processing` status
- **Cause**: Redis queue failure or worker process exited during embedding.
- **Fix**: Check `ENABLE_BACKGROUND_WORKER=true` in `.env`. Check console logs for Gemini embedding quota limits. If Redis is down, the system automatically falls back to an in-memory queue.

---

## 2. Gemini API Errors

### Error: `RESOURCE_EXHAUSTED / 429 Too Many Requests`
- **Cause**: Gemini API key exceeded tier quota.
- **Fix**: The built-in retry mechanism will back off with jitter and retry up to 3 times. If daily free tier quota (RPD) is reached, the circuit breaker safely transitions to `OPEN` to prevent spamming until midnight PT reset. For high traffic, upgrade to pay-as-you-go in Google AI Studio.

---

## 3. Database Connectivity

### Error: `MongooseServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017`
- **Cause**: MongoDB is not running or URI is incorrect.
- **Fix**: Start local MongoDB service (`sudo systemctl start mongod` or `net start MongoDB` on Windows), or use a cloud MongoDB Atlas connection string in `MONGODB_URI`.

### Error: `Qdrant connection refused on port 6333`
- **Cause**: Qdrant vector database is not running or unreachable.
- **Fix**: If running locally on Windows/Linux, execute `npm run qdrant:start`. If using Qdrant Cloud, confirm `QDRANT_URL` and `QDRANT_API_KEY` in `.env`.

---

## 4. Telegram Bot Account Linking

### Error: `Invalid or expired link code`
- **Cause**: Link codes are valid for 10 minutes and can only be used once.
- **Fix**: Generate a fresh code and send `/link <code>` in Telegram within 10 minutes.
