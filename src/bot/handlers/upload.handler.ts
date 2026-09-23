import path from 'node:path';
import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { Context } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { quotaService } from '../../modules/users/quota.service.js';
import { DocumentModel } from '../../database/models/Document.js';
import { StorageFactory } from '../../storage/StorageProvider.js';
import { parserRegistry } from '../../ingestion/parsers/index.js';
import { jobQueue } from '../../jobs/jobQueue.js';
import { config } from '../../config/env.js';
import { escapeHtml } from '../../utils/telegram.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('upload.handler');

export async function handleDocumentUpload(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message: any = ctx.message;

  if (!from || !message || !message.document) {
    return;
  }

  const document = message.document;
  const rawFileName = document.file_name || 'study-material';
  const mimeType = document.mime_type || 'application/octet-stream';
  const fileId = document.file_id;
  const sanitizedFileName = path.basename(rawFileName).replace(/[^a-zA-Z0-9._\- ]/g, '_');

  log.info({ userId: from.id, fileName: rawFileName, mimeType, fileSize: document.file_size }, 'Document upload received.');

  // 1. Ensure student user exists in database
  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });

  const userId = user._id.toString();

  // 2. Enforce quota limits
  const quotaCheck = await quotaService.checkUploadQuota(userId);
  if (!quotaCheck.allowed) {
    const errorHtml = `⚠️ <b>അപ്‌ലോഡ് പരിധി കഴിഞ്ഞു (Upload Limit Reached)</b>\n\n${escapeHtml(quotaCheck.malayalamReason || '')}\n\n<i>${escapeHtml(quotaCheck.reason || '')}</i>`;
    await ctx.reply(errorHtml, { parse_mode: 'HTML' });
    return;
  }

  // 3. Format support validation
  const parser = parserRegistry.getParser(sanitizedFileName, mimeType);
  if (!parser) {
    const errorMsg = `❌ I couldn't process <b>${escapeHtml(rawFileName)}</b>.\n\nUnsupported file format. Please upload PDF, DOCX, TXT, Markdown, or Images (PNG, JPG, WEBP).`;
    await ctx.reply(errorMsg, { parse_mode: 'HTML' });
    return;
  }

  // 4. Immediate user confirmation
  let statusMessageId: number | undefined;
  try {
    const sent = await ctx.reply(`📥 <b>Received:</b> <code>${escapeHtml(rawFileName)}</code>\n\n⏳ <i>Enqueued for background processing...</i>`, {
      parse_mode: 'HTML',
    });
    statusMessageId = sent.message_id;
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to send initial status message.');
  }

  try {
    // 5. Download file from Telegram
    log.debug({ fileId }, 'Fetching file link from Telegram...');
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(fileLink.toString());

    if (!response.ok) {
      throw new Error(`Failed to download file from Telegram: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // 6. File size validation
    const maxSizeBytes = config.MAX_FILE_SIZE_MB * 1024 * 1024;
    if (fileBuffer.length > maxSizeBytes) {
      const errorMsg = `❌ File size exceeds the maximum limit of ${config.MAX_FILE_SIZE_MB}MB.`;
      if (statusMessageId && ctx.chat) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMessageId, undefined, errorMsg);
      } else {
        await ctx.reply(errorMsg);
      }
      return;
    }

    // 7. Duplicate check via SHA-256
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const existingDoc = await DocumentModel.findOne({
      userId: new Types.ObjectId(userId),
      fileHash,
      status: 'ready',
    });

    if (existingDoc) {
      const msg = `⚠️ <b>You already uploaded this document.</b>\n\n📄 <code>${escapeHtml(rawFileName)}</code>`;
      if (statusMessageId && ctx.chat) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMessageId, undefined, msg, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(msg, { parse_mode: 'HTML' });
      }
      return;
    }

    // 8. Store file safely via StorageProvider
    const docId = new Types.ObjectId();
    const storageKey = `${userId}/${docId.toString()}/original-file`;
    const storage = StorageFactory.getProvider();
    await storage.upload(storageKey, fileBuffer, mimeType);

    // 9. Create Document record in DB with 'processing' status
    await DocumentModel.create({
      _id: docId,
      userId: new Types.ObjectId(userId),
      telegramFileId: fileId,
      fileName: sanitizedFileName,
      mimeType,
      fileSize: fileBuffer.length,
      fileHash,
      storagePath: storage.getAbsolutePath ? storage.getAbsolutePath(storageKey) : storageKey,
      storageKey,
      status: 'processing',
    });

    // 10. Enqueue asynchronous background job
    await jobQueue.addIngestionJob(
      {
        userId,
        documentId: docId.toString(),
        storageKey,
        fileName: sanitizedFileName,
        mimeType,
      },
      {
        telegram: ctx.telegram,
        chatId: ctx.chat!.id,
        statusMessageId,
      }
    );

    log.info({ userId, docId: docId.toString(), fileName: sanitizedFileName }, 'Document successfully enqueued for processing.');
  } catch (error: any) {
    log.error({ error: error.message, fileName: rawFileName }, 'Unexpected error enqueuing document upload.');
    const errorMsg = `❌ I couldn't process <b>${escapeHtml(rawFileName)}</b>.\n\nPlease check that the file is valid and try again.`;
    if (statusMessageId && ctx.chat) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMessageId, undefined, errorMsg, {
          parse_mode: 'HTML',
        });
      } catch {
        await ctx.reply(errorMsg, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.reply(errorMsg, { parse_mode: 'HTML' });
    }
  }
}

export async function handlePhotoUpload(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message: any = ctx.message;

  if (!from || !message || !Array.isArray(message.photo) || message.photo.length === 0) {
    return;
  }

  // Telegram sends photos in multiple sizes; pick the largest
  const photo = message.photo[message.photo.length - 1];
  const fileId = photo.file_id;
  const rawFileName = message.caption ? `${message.caption.slice(0, 30).trim().replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg` : `photo_note_${Date.now()}.jpg`;
  const mimeType = 'image/jpeg';
  const sanitizedFileName = path.basename(rawFileName).replace(/[^a-zA-Z0-9._\- ]/g, '_');

  log.info({ userId: from.id, fileId, width: photo.width, height: photo.height }, 'Photo upload received.');

  // 1. Ensure user exists
  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });

  const userId = user._id.toString();

  // 2. Enforce quota limits
  const quotaCheck = await quotaService.checkUploadQuota(userId);
  if (!quotaCheck.allowed) {
    const errorHtml = `⚠️ <b>അപ്‌ലോഡ് പരിധി കഴിഞ്ഞു (Upload Limit Reached)</b>\n\n${escapeHtml(quotaCheck.malayalamReason || '')}\n\n<i>${escapeHtml(quotaCheck.reason || '')}</i>`;
    await ctx.reply(errorHtml, { parse_mode: 'HTML' });
    return;
  }

  // 3. Immediate user confirmation
  let statusMessageId: number | undefined;
  try {
    const sent = await ctx.reply(`📸 Received image: <code>${escapeHtml(rawFileName)}</code>\n\n⏳ <i>Enqueued for Gemini Multimodal OCR...</i>`, {
      parse_mode: 'HTML',
    });
    statusMessageId = sent.message_id;
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to send initial status message for photo.');
  }

  try {
    // 4. Download photo from Telegram
    log.debug({ fileId }, 'Fetching photo link from Telegram...');
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(fileLink.toString());

    if (!response.ok) {
      throw new Error(`Failed to download photo from Telegram: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // 5. Duplicate check via SHA-256
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const existingDoc = await DocumentModel.findOne({
      userId: new Types.ObjectId(userId),
      fileHash,
      status: 'ready',
    });

    if (existingDoc) {
      const msg = `⚠️ <b>You already uploaded this image.</b>\n\n🖼️ <code>${escapeHtml(rawFileName)}</code>`;
      if (statusMessageId && ctx.chat) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMessageId, undefined, msg, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(msg, { parse_mode: 'HTML' });
      }
      return;
    }

    // 6. Store file safely via StorageProvider
    const docId = new Types.ObjectId();
    const storageKey = `${userId}/${docId.toString()}/original-file.jpg`;
    const storage = StorageFactory.getProvider();
    await storage.upload(storageKey, fileBuffer, mimeType);

    // 7. Create Document record in DB with 'processing' status
    await DocumentModel.create({
      _id: docId,
      userId: new Types.ObjectId(userId),
      telegramFileId: fileId,
      fileName: sanitizedFileName,
      mimeType,
      fileSize: fileBuffer.length,
      fileHash,
      storagePath: storage.getAbsolutePath ? storage.getAbsolutePath(storageKey) : storageKey,
      storageKey,
      status: 'processing',
    });

    // 8. Enqueue asynchronous background job
    await jobQueue.addIngestionJob(
      {
        userId,
        documentId: docId.toString(),
        storageKey,
        fileName: sanitizedFileName,
        mimeType,
      },
      {
        telegram: ctx.telegram,
        chatId: ctx.chat!.id,
        statusMessageId,
      }
    );

    log.info({ userId, docId: docId.toString(), fileName: sanitizedFileName }, 'Photo successfully enqueued for OCR & indexing.');
  } catch (error: any) {
    log.error({ error: error.message, fileName: rawFileName }, 'Unexpected error processing photo upload.');
    const errorMsg = `❌ I couldn't process <b>${escapeHtml(rawFileName)}</b>.\n\nPlease check the image and try again.`;
    if (statusMessageId && ctx.chat) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMessageId, undefined, errorMsg, {
          parse_mode: 'HTML',
        });
      } catch {
        await ctx.reply(errorMsg, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.reply(errorMsg, { parse_mode: 'HTML' });
    }
  }
}
