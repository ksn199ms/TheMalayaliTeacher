# 🏛️ TheMalayaliTeacher — Architecture Overview

TheMalayaliTeacher is a production-grade, bilingual (Malayalam & English) Retrieval-Augmented Generation (RAG) platform powered exclusively by Google Gemini. It provides an interactive Telegram Bot interface backed by unified core services, Express REST API, and strict multi-tenant isolation.

---

## 1. High-Level System Architecture

```mermaid
flowchart TD
    subgraph Clients
        Web["Next.js Web Application\n(TypeScript, Tailwind CSS)"]
        Bot["Telegram Bot Interface\n(Telegraf, Markdown)"]
    end

    subgraph API & Gateway
        Express["Express REST API (Port 5000)\nCORS, Helmet, RateLimiter, JWT"]
        BotPolling["Telegram Long Polling Handler"]
    end

    subgraph Authentication & Access Control
        Auth["AuthService (Bcrypt 12 rounds, JWT)\nUser Tenant Isolation & Telegram /link"]
    end

    subgraph Storage Layer
        Storage["StorageProvider Abstraction"]
        LocalStorage["LocalStorageProvider\n(Path Traversal Guarded)"]
        S3Storage["S3StorageProvider\n(AWS / MinIO Compatible)"]
        Storage --> LocalStorage
        Storage --> S3Storage
    end

    subgraph Async Ingestion
        JobQueue["JobQueue & Worker\n(Redis Queue / In-Memory Fallback)"]
        DocExtractor["Text Extraction & Chunking"]
    end

    subgraph RAG & AI Core
        GeminiService["GeminiService (Flash / Pro)\nRate-Limiter, Retry & Jitter, Quota Cache"]
        EmbeddingService["EmbeddingService\n(gemini-embedding-001)"]
        RAGPipeline["V4 Advanced RAG Pipeline\nHybrid Search, Reranking, Grounding & Citations"]
    end

    subgraph Persistence Layer
        MongoDB[(MongoDB\nUsers, Docs, Threads, Messages, Sessions)]
        Qdrant[(Qdrant Vector DB\nVectors isolated by userId payload filter)]
    end

    Web -->|HTTP / JSON (JWT / Cookies)| Express
    Bot --> BotPolling

    Express --> Auth
    BotPolling --> Auth

    Express --> Storage
    Express --> JobQueue
    Express --> RAGPipeline

    JobQueue --> DocExtractor
    DocExtractor --> EmbeddingService
    EmbeddingService --> Qdrant
    JobQueue --> MongoDB

    RAGPipeline --> Qdrant
    RAGPipeline --> GeminiService
    RAGPipeline --> MongoDB
```

---

## 2. Core Architectural Pillars

### 2.1 Multi-Tenant Data Isolation
- **Storage**: Files are saved with nonces and sanitized names. Path traversal attacks (`..`, absolute paths) are blocked at the `StorageProvider` layer.
- **MongoDB**: Every query enforces `{ userId: authenticatedUserId }`. Cross-user access returns HTTP 403 / 404.
- **Vector Search (Qdrant)**: Every similarity and hybrid search query includes a strict filter:
  ```json
  {
    "must": [
      { "key": "userId", "match": { "value": "<authenticatedUserId>" } }
    ]
  }
  ```
  Vectors from other users cannot leak into retrieval context under any circumstance.

### 2.2 Shared Core Engine (Zero Business Logic Duplication)
Both the Express REST API (consumed by Web) and the Telegram Bot call the exact same underlying services:
- `ragService.query()`
- `studyAssistantService.generateExplanation()`
- `studyAssistantService.generateSummary()`
- `studyAssistantService.generateKeyPoints()`
- `studyAssistantService.generateQuiz()`
- `studyAssistantService.generateFlashcards()`
- `studyAssistantService.generateSimplified()`

### 2.3 Single Sign-On & Bot Account Linking
- Web users can generate a time-limited (10-minute) single-use 6-character code (`/api/auth/telegram-code`).
- Sending `/link <code>` in Telegram instantly binds their Telegram ID to their Web User account, seamlessly merging all documents and chat histories.

### 2.4 Asynchronous Worker Ingestion
- Uploading large PDFs or DOCX files does not block the HTTP request.
- The upload route uploads the file to `StorageProvider`, creates a `ProcessingJob`, and dispatches the task to `jobQueue`.
- The background worker extracts text, chunks content, generates embeddings via Gemini, indexes points into Qdrant, and updates the document status to `completed`.
