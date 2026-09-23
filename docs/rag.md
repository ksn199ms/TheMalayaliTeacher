# 🧠 TheMalayaliTeacher — RAG Pipeline Architecture

TheMalayaliTeacher runs a production-optimized Retrieval-Augmented Generation (RAG) pipeline tailored for academic text, textbooks, lecture slides, student notes, and Malayalam/English multilingual queries.

---

## 1. Document Ingestion Lifecycle

```
[Student Upload (PDF/DOCX/TXT/MD)]
               │
               ▼
   [StorageProvider Save]
               │
               ▼
   [Async Worker Job Queue]
               │
               ▼
   [Text Extraction & Normalization]
               │
               ▼
   [Recursive Character Chunking (700 chars, 100 overlap)]
               │
               ▼
   [Gemini Embeddings (gemini-embedding-001)]
               │
               ▼
   [Qdrant Upsert with userId Payload Isolation]
               │
               ▼
   [Document Status: Completed]
```

---

## 2. Retrieval & Query Processing

1. **Query Rewriting & Expansion**:
   - Query expanded with academic synonyms and context (if enabled).
2. **Hybrid Search**:
   - Dense vector similarity search combined with sparse BM25 text match in Qdrant.
   - Candidates retrieved: `RETRIEVAL_CANDIDATES` (default: 20 chunks).
3. **Cross-Document Reranking**:
   - Relevance scoring and deduplication prune redundant paragraphs down to `FINAL_CONTEXT_CHUNKS` (default: 6 chunks).
4. **Prompt Assembly & Grounding**:
   - Context is injected with numbered source tags `[Doc: <name>, Page: <num>]`.
   - Strict instructions prevent hallucinations. If context does not contain the answer, the assistant clearly informs the student.
5. **Citations & Verification**:
   - Extracted citations are validated against actual source chunks and returned with document name, page number, and relevant snippet.
