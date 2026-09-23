import { User, IUser } from '../../database/models/User.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('user.service');

export interface UpsertUserDTO {
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export class UserService {
  public async getOrCreateUser(data: UpsertUserDTO): Promise<IUser> {
    try {
      const user = await User.findOneAndUpdate(
        { telegramId: data.telegramId },
        {
          $set: {
            username: data.username,
            firstName: data.firstName,
            lastName: data.lastName,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      log.debug({ telegramId: data.telegramId, userId: user._id }, 'User upserted successfully.');
      return user;
    } catch (error: any) {
      log.error({ error: error.message, telegramId: data.telegramId }, 'Failed to get or create user.');
      throw error;
    }
  }

  public async findByTelegramId(telegramId: string): Promise<IUser | null> {
    return User.findOne({ telegramId });
  }
}

export const userService = new UserService();
