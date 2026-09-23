import 'dotenv/config';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { DocumentModel } from '../src/database/models/Document.js';
import { parserRegistry } from '../src/ingestion/parsers/index.js';
import { cleanText } from '../src/ingestion/cleaner.js';
import { chunkingService, DocumentChunk } from '../src/ingestion/chunker.js';
import { embeddingService } from '../src/embeddings/embedding.service.js';
import { qdrantService } from '../src/vector/qdrant.service.js';
import { config } from '../src/config/env.js';

function detectDocLanguage(text: string): 'en' | 'ml' | 'mixed' {
  const malayalamChars = (text.match(/[\u0D00-\u0D7F]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  if (malayalamChars > 20 && englishChars > 20) return 'mixed';
  if (malayalamChars > 20) return 'ml';
  return 'en';
}

async function main() {
  const force = process.argv.includes('--force');
  await connectDatabase(config.MONGODB_URI);
  await qdrantService.ensureCollection(embeddingService.getDimension());

  const docs = await DocumentModel.find({ status: 'ready' });
  console.log(`Found ${docs.length} ready documents. Target indexVersion: ${config.INDEX_VERSION}, Force: ${force}`);

  let updatedCount = 0;

  for (const doc of docs) {
    console.log(`Checking document: ${doc.fileName} (${doc._id})`);

    const existingChunks = await qdrantService.getDocumentChunks(
      doc.userId.toString(),
      doc._id.toString(),
      5
    );

    const needsReindexing =
      force ||
      existingChunks.length === 0 ||
      (doc.indexVersion ?? 1) < config.INDEX_VERSION;

    if (!needsReindexing) {
      console.log(`- Document already up-to-date (indexVersion: ${doc.indexVersion}, chunks: ${existingChunks.length}).`);
      continue;
    }

    console.log(`- Re-indexing to V${config.INDEX_VERSION} from disk (${doc.storagePath})...`);
    try {
      const fileBuffer = await fs.readFile(doc.storagePath);
      const parser = parserRegistry.getParser(doc.fileName, doc.mimeType);
      if (!parser) {
        console.error(`- No parser found for ${doc.fileName}`);
        continue;
      }

      const parsedDoc = await parser.parse(doc.storagePath, doc.fileName);
      const allChunks: DocumentChunk[] = [];
      let fullDocText = '';

      for (const page of parsedDoc.pages) {
        const cleaned = cleanText(page.text);
        if (!cleaned) continue;
        fullDocText += ' ' + cleaned;

        const chunks = chunkingService.chunkText(cleaned, {
          userId: doc.userId.toString(),
          documentId: doc._id.toString(),
          fileName: doc.fileName,
          pageNumber: page.pageNumber,
          language: doc.language,
          indexVersion: config.INDEX_VERSION,
        });

        allChunks.push(...chunks);
      }

      if (allChunks.length === 0) {
        console.warn(`- Document contains no extractable text.`);
        continue;
      }

      const detectedLang = detectDocLanguage(fullDocText);

      // Clear old vectors
      await qdrantService.deleteDocumentVectors(doc.userId.toString(), doc._id.toString());

      console.log(`- Extracted ${allChunks.length} chunks. Generating embeddings...`);
      const textsToEmbed = allChunks.map((c) => c.text);
      const batchSize = 50;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < textsToEmbed.length; i += batchSize) {
        const batch = textsToEmbed.slice(i, i + batchSize);
        const embeddings = await embeddingService.embedDocuments(batch);
        allEmbeddings.push(...embeddings);
      }

      console.log(`- Upserting ${allChunks.length} vectors to Qdrant with V${config.INDEX_VERSION} metadata...`);
      const points = allChunks.map((chunk, idx) => ({
        id: crypto.randomUUID(),
        vector: allEmbeddings[idx],
        payload: {
          userId: doc.userId.toString(),
          documentId: doc._id.toString(),
          fileName: doc.fileName,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          heading: chunk.heading,
          section: chunk.section,
          language: chunk.language || detectedLang,
          indexVersion: config.INDEX_VERSION,
        },
      }));

      await qdrantService.upsertVectors(points);

      doc.pageCount = parsedDoc.pages.length;
      doc.indexVersion = config.INDEX_VERSION;
      doc.language = detectedLang;
      await doc.save();

      updatedCount++;
      console.log(`- Successfully re-indexed ${doc.fileName} to V${config.INDEX_VERSION}!`);
    } catch (err: any) {
      console.error(`- Failed to re-index ${doc.fileName}:`, err.message);
    }
  }

  await disconnectDatabase();
  console.log(`Re-indexing completed. Updated ${updatedCount} documents.`);
}

main().catch(console.error);
