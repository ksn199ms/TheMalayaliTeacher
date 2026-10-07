import { DocumentModel } from '../../database/models/Document.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('retrieval.filters');

export interface ValidatedRetrievalScope {
  userId: string;
  documentIds?: string[];
  hasDocuments?: boolean;
}

/**
 * Validates and sanitizes retrieval options, strictly enforcing user isolation
 * and verifying that any requested documentIds belong to the specified user.
 */
export async function buildRetrievalFilter(
  userId: string,
  requestedDocIds?: string[]
): Promise<ValidatedRetrievalScope> {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('Security isolation violation: userId is required and must be a valid non-empty string.');
  }

  const cleanUserId = userId.trim();

  try {
    if (!requestedDocIds || requestedDocIds.length === 0) {
      const readyDocCount = await DocumentModel.countDocuments({
        userId: cleanUserId,
        status: 'ready',
      });
      return {
        userId: cleanUserId,
        hasDocuments: readyDocCount > 0,
      };
    }

    // Filter out any invalid / empty IDs
    const candidateIds = requestedDocIds
      .filter((id) => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());

    if (candidateIds.length === 0) {
      const readyDocCount = await DocumentModel.countDocuments({
        userId: cleanUserId,
        status: 'ready',
      });
      return {
        userId: cleanUserId,
        hasDocuments: readyDocCount > 0,
      };
    }

    // Verify in MongoDB that these documents belong to cleanUserId
    const ownedDocs = await DocumentModel.find(
      { _id: { $in: candidateIds }, userId: cleanUserId },
      { _id: 1 }
    ).lean();

    const verifiedIds = ownedDocs.map((d: any) => d._id.toString());

    if (verifiedIds.length === 0 && candidateIds.length > 0) {
      log.warn(
        { userId: cleanUserId, candidateIds },
        'None of the requested documentIds belong to user; searching all user documents instead.'
      );
      const readyDocCount = await DocumentModel.countDocuments({
        userId: cleanUserId,
        status: 'ready',
      });
      return {
        userId: cleanUserId,
        hasDocuments: readyDocCount > 0,
      };
    }

    return {
      userId: cleanUserId,
      documentIds: verifiedIds,
      hasDocuments: verifiedIds.length > 0,
    };
  } catch (error: any) {
    log.error({ error: error.message, userId: cleanUserId }, 'Failed to verify document ownership in MongoDB.');
    // Fail safe: isolate strictly by userId and allow search
    return { userId: cleanUserId, hasDocuments: true };
  }
}

