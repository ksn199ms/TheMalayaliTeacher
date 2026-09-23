# 🔒 TheMalayaliTeacher — Security & Isolation Model

TheMalayaliTeacher processes student notes, lecture materials, and academic queries. Security and multi-tenant data privacy are built into every layer.

---

## 1. Authentication & Session Security

- **Password Hashing**: Bcrypt with a work factor of 12 rounds.
- **JWT Authentication**: Signed with HMAC-SHA256 using a minimum 32-character secret. Expiration defaults to 7 days.
- **Cookie Security**: Auth cookies are emitted with:
  - `httpOnly: true` (prevents JavaScript XSS theft)
  - `sameSite: 'lax'` (protects against CSRF attacks)
  - `secure: true` in production environments (enforces HTTPS)
- **Rate Limiting**:
  - Global API: 120 requests / minute
  - Authentication endpoints: 10 attempts / 15 minutes (mitigates brute-force)
  - Document uploads: 10 uploads / 15 minutes
  - AI Generation: 15 queries / minute

---

## 2. Strict Tenant Data Isolation

Every resource in the database and vector engine is strictly owned by a user:
1. **Document Ownership Verification**:
   - Querying, retrieving, or deleting documents always applies `{ _id: docId, userId: authenticatedUserId }`.
   - Cross-user retrieval attempts immediately yield `404 Not Found` or `403 Forbidden`.
2. **Vector Space Partitioning**:
   - Chunks stored in Qdrant store `userId: user.id` in their payload.
   - All similarity, hybrid, and text searches apply a strict payload filter constraint on `userId`.
   - Chunks belonging to User A will **never** appear in the context window of User B.
3. **Storage Security**:
   - `LocalStorageProvider` resolves safe paths and blocks directory traversal (`..`, absolute paths).
   - Random nonces and sanitized filenames prevent file overwrites.

---

## 3. Account Deletion & Right to be Forgotten

Executing `DELETE /api/auth/account`:
1. Deletes all user's physical files from storage.
2. Removes all chunk vector points from Qdrant via `deleteUserVectors(userId)`.
3. Removes all chat threads, messages, and study sessions from MongoDB.
4. Soft-deletes / removes the user record.
