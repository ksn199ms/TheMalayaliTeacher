# 🔌 TheMalayaliTeacher — REST API Reference

The backend exposes an Express REST API with JSON payloads, standard HTTP status codes, cookie-based session and `Authorization: Bearer <token>` support, and strict tenant isolation.

Base URL: `http://localhost:5000` (or configured `PORT`)

---

## 1. Authentication Endpoints (`/api/auth`)

### `POST /api/auth/register`
Create a new student account.
- **Request Body**:
  ```json
  {
    "email": "student@example.com",
    "password": "SecurePassword123!",
    "name": "Alex Student"
  }
  ```
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "user": {
      "id": "60f7b1...",
      "email": "student@example.com",
      "name": "Alex Student",
      "role": "student"
    },
    "token": "eyJhbGciOi..."
  }
  ```
- Sets `httpOnly`, `SameSite=Lax` cookie `token`.

### `POST /api/auth/login`
Authenticate with email and password.
- **Request Body**:
  ```json
  {
    "email": "student@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response** (`200 OK`): User object and JWT token.

### `POST /api/auth/logout`
Clears session cookie.
- **Response** (`200 OK`): `{"success": true, "message": "Logged out successfully"}`

### `GET /api/auth/me`
Retrieve currently logged-in user profile and linked Telegram account status.
- **Headers**: `Authorization: Bearer <token>` or Cookie
- **Response** (`200 OK`): User metadata.

### `POST /api/auth/telegram-code`
Generates a 6-character single-use link code valid for 10 minutes to link with Telegram `/link <code>`.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "code": "AB39K2",
    "expiresAt": "2026-09-19T14:40:00.000Z"
  }
  ```

### `DELETE /api/auth/account`
Cascades deletion of user, associated documents from disk and MongoDB, vectors from Qdrant, and chat threads.

---

## 2. Document Management (`/api/documents`)

### `POST /api/documents/upload`
Upload a document (PDF, DOCX, TXT, MD). Form-data field: `file`.
- **Response** (`201 Created`):
  ```json
  {
    "success": true,
    "document": {
      "id": "660...",
      "name": "lecture_01.pdf",
      "size": 1048576,
      "status": "processing"
    },
    "jobId": "job_12345"
  }
  ```

### `GET /api/documents`
List user documents with status and metadata.

### `GET /api/documents/:id`
Fetch document details and processing status.

### `DELETE /api/documents/:id`
Deletes document from storage, database, and deletes all corresponding chunks from Qdrant.

---

## 3. Chat & RAG Q&A (`/api/chats`)

### `POST /api/chats`
Create a new chat thread.
- **Request Body**:
  ```json
  {
    "title": "Data Structures Q&A",
    "documentIds": ["660...", "661..."]
  }
  ```

### `POST /api/chats/:id/messages`
Ask a question in a thread. Executes V4 RAG pipeline.
- **Request Body**:
  ```json
  {
    "message": "Explain B-Trees from my notes",
    "documentIds": []
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": {
      "role": "assistant",
      "content": "B-Trees are self-balancing search trees...",
      "citations": [
        {
          "documentName": "lecture_01.pdf",
          "pageNumber": 14,
          "snippet": "A B-tree of order m is..."
        }
      ]
    }
  }
  ```

---

## 4. Study Assistant Modes (`/api/study`)

- `POST /api/study/explain`: Detailed breakdown with concept explanations.
- `POST /api/study/simplify`: "Explain Like I'm 5" simplified breakdown with analogies.
- `POST /api/study/summarize`: Concise high-yield chapter/document summary.
- `POST /api/study/keypoints`: Bulleted core takeaways.
- `POST /api/study/quiz`: Generates multi-choice quiz questions (answer keys hidden until student answers).
- `POST /api/study/quiz/:id/answer`: Validates student answer and records score.
- `POST /api/study/flashcards`: Generates front/back study flashcards.

---

## 5. Health & Monitoring

- `GET /health`: Liveness probe (`{"status": "ok", "uptime": 124.5}`).
- `GET /ready`: Readiness probe checking MongoDB, Qdrant, and Gemini connectivity.
- `GET /api/usage`: Current user quota, query counts, and study mode metrics.
- `GET /api/admin/metrics`: Aggregated system metrics (Admin role required).
