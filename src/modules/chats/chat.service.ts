import { Types } from 'mongoose';
import { Chat, IChat } from '../../database/models/Chat.js';
import { Message, IMessage, ICitation } from '../../database/models/Message.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('chat.service');

export class ChatService {
  /**
   * Finds or creates the default chat thread for a user
   */
  public async getOrCreateUserChat(userId: string): Promise<IChat> {
    let chat = await Chat.findOne({ userId: new Types.ObjectId(userId) });
    if (!chat) {
      chat = await Chat.create({
        userId: new Types.ObjectId(userId),
        documentIds: [],
        title: 'Main Study Chat',
      });
      log.debug({ userId, chatId: chat._id }, 'Created new chat thread for user.');
    }
    return chat;
  }

  /**
   * Save a message (user or assistant) in MongoDB
   */
  public async addMessage(
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
    citations?: ICitation[]
  ): Promise<IMessage> {
    return Message.create({
      chatId: new Types.ObjectId(chatId),
      role,
      content,
      citations,
    });
  }

  /**
   * Get recent conversation history for context
   */
  public async getRecentHistory(chatId: string, limit: number = 10): Promise<IMessage[]> {
    const messages = await Message.find({ chatId: new Types.ObjectId(chatId) })
      .sort({ createdAt: -1 })
      .limit(limit);

    return messages.reverse(); // Return in chronological order
  }

  /**
   * Clear all messages in a chat thread
   */
  public async clearChat(chatId: string): Promise<void> {
    await Message.deleteMany({ chatId: new Types.ObjectId(chatId) });
    log.info({ chatId }, 'Cleared messages in chat.');
  }
}

export const chatService = new ChatService();
