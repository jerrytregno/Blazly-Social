import * as knowledgeBaseRepo from '../db/repositories/knowledgeBaseRepository.js';

export async function upsertSelf(userId, sourceUrl, extractedText, structuredData = null) {
  await knowledgeBaseRepo.findOneAndUpdate(
    { userId, type: 'self', sourceUrl },
    { extractedText, structuredData: structuredData ?? null },
    { upsert: true, new: true }
  );
}

export async function upsertCompetitor(userId, sourceUrl, extractedText, structuredData = null) {
  await knowledgeBaseRepo.findOneAndUpdate(
    { userId, type: 'competitor', sourceUrl },
    { extractedText, structuredData: structuredData ?? null },
    { upsert: true, new: true }
  );
}

export async function getSelf(userId) {
  return knowledgeBaseRepo.findOne({ userId, type: 'self' });
}

export async function getCompetitors(userId) {
  return knowledgeBaseRepo.find({ userId, type: 'competitor' });
}
